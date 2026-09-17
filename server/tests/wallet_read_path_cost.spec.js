/**
 * O CUSTO DE ABRIR A CARTEIRA — o que o caminho de leitura pede ao banco.
 *
 * Em 17/09/2026 o painel de Saúde acusou `GET /api/wallet/` com p95 de 1,02 s e
 * p50 de 820 ms. Distribuição estreita assim não é pico: é custo FIXO, pago em
 * toda abertura de carteira. Dois pedaços dele não serviam para nada:
 *
 *  1) A série SELIC INTEIRA, em carteira sem um centavo de renda fixa.
 *     `earliestFixedIncomeLotDate` devolve `null` quando não há CASH/FIXED_INCOME,
 *     e `loadCdiCurve` sem `since` lê a série toda. As duas funções pareciam
 *     combinar e não combinavam: o resultado era ler todos os dias úteis já
 *     gravados da SELIC, montar o Map de todos eles e jogar fora — `cdiCurve` só
 *     é consultado dentro do ramo `CASH || FIXED_INCOME` de `processWalletAsset`.
 *
 *  2) A série USD-BRL DUAS vezes na mesma requisição — uma para resolver um único
 *     dia (o câmbio do dia-âncora) e outra no fluxo do período. É justamente a
 *     série isenta do teto de 400 candles (HISTORY_CAP_EXEMPT_TICKERS), ou seja, a
 *     mais longa que a carteira lê, e ela cresce um ponto por dia para sempre.
 *
 * Estes testes contam IDAS AO BANCO, não milissegundos: o número de milissegundos
 * depende da máquina, o número de leituras é o contrato.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../models/EconomicIndex.js', () => ({
    default: { find: vi.fn(() => ({ lean: async () => [] })) },
}));

// `select` é um spy próprio para que o teste possa afirmar QUAL projeção foi
// pedida — trazer o documento inteiro é exatamente o que se quer impedir.
const selectSpy = vi.fn(() => ({ lean: async () => ({ history: [] }) }));
vi.mock('../models/AssetHistory.js', () => ({
    default: { findOne: vi.fn(() => ({ select: selectSpy })) },
}));

const { default: EconomicIndex } = await import('../models/EconomicIndex.js');
const { default: AssetHistory } = await import('../models/AssetHistory.js');
const { loadCdiCurveForAssets, hasFixedIncome } = await import('../utils/cdiCurve.js');
const { loadUsdRateResolver } = await import('../utils/fxRate.js');
const { usdRateLoaderOnce } = await import('../controllers/walletController.js');

const acao = { type: 'STOCK', ticker: 'PETR4' };
const fii = { type: 'FII', ticker: 'MXRF11' };
const cripto = { type: 'CRYPTO', ticker: 'BTC' };
const tesouro = {
    type: 'FIXED_INCOME',
    ticker: 'TESOURO SELIC 2029',
    taxLots: [{ date: new Date('2026-01-15T00:00:00.000Z') }],
};
const caixa = { type: 'CASH', ticker: 'RESERVA', startDate: new Date('2026-02-01T00:00:00.000Z') };

describe('curva do CDI — só quem precisa dela vai ao banco', () => {
    it('carteira sem renda fixa não lê a série SELIC', async () => {
        EconomicIndex.find.mockClear();

        const curva = await loadCdiCurveForAssets([acao, fii, cripto], { currentRate: 13.9 });

        expect(EconomicIndex.find).not.toHaveBeenCalled();
        expect(curva.size).toBe(0);
    });

    it('carteira vazia também não lê', async () => {
        EconomicIndex.find.mockClear();
        await loadCdiCurveForAssets([], { currentRate: 13.9 });
        await loadCdiCurveForAssets(undefined, { currentRate: 13.9 });
        expect(EconomicIndex.find).not.toHaveBeenCalled();
    });

    it('com renda fixa, lê — e recortada pelo lote mais antigo', async () => {
        EconomicIndex.find.mockClear();

        await loadCdiCurveForAssets([acao, tesouro], { currentRate: 13.9 });

        expect(EconomicIndex.find).toHaveBeenCalledTimes(1);
        const filtro = EconomicIndex.find.mock.calls[0][0];
        expect(filtro.series).toBe('SELIC');
        expect(filtro.date.$gte).toEqual(new Date('2026-01-15T00:00:00.000Z'));
    });

    it('caixa conta como renda fixa — rende, logo precisa da curva', async () => {
        EconomicIndex.find.mockClear();
        await loadCdiCurveForAssets([caixa], { currentRate: 13.9 });
        expect(EconomicIndex.find).toHaveBeenCalledTimes(1);
    });

    /**
     * A guarda é "tem renda fixa?", não "achei uma data de lote". Posição de RF sem
     * data utilizável continua lendo a série inteira: é o fallback seguro, e trocá-lo
     * por curva vazia aqui pouparia uma consulta ao preço de um número pior na tela.
     */
    it('renda fixa sem data de lote ainda lê a série inteira, de propósito', async () => {
        EconomicIndex.find.mockClear();

        await loadCdiCurveForAssets([{ type: 'FIXED_INCOME', ticker: 'CDB X', taxLots: [] }], { currentRate: 13.9 });

        expect(EconomicIndex.find).toHaveBeenCalledTimes(1);
        expect(EconomicIndex.find.mock.calls[0][0]).not.toHaveProperty('date');
    });

    it('hasFixedIncome separa as duas classes que a curva valoriza', () => {
        expect(hasFixedIncome([acao, fii, cripto])).toBe(false);
        expect(hasFixedIncome([acao, tesouro])).toBe(true);
        expect(hasFixedIncome([caixa])).toBe(true);
        expect(hasFixedIncome([])).toBe(false);
        expect(hasFixedIncome(null)).toBe(false);
    });
});

describe('série USD-BRL — a mais longa do banco, lida com projeção', () => {
    /**
     * `USD-BRL` está em HISTORY_CAP_EXEMPT_TICKERS: nunca é truncada nos 400 candles.
     * Trazer o documento inteiro sem projeção é o pior caso de leitura da carteira.
     */
    it('pede só o campo history, não o documento inteiro', async () => {
        AssetHistory.findOne.mockClear();
        selectSpy.mockClear();

        await loadUsdRateResolver(5.4);

        expect(AssetHistory.findOne).toHaveBeenCalledWith({ ticker: 'USD-BRL' });
        expect(selectSpy).toHaveBeenCalledWith('history');
    });

    /**
     * Os dois consumidores da requisição — o câmbio do dia-âncora e o fluxo do
     * período — dividem UMA leitura. Eram duas, e o dado é imutável dentro da
     * requisição, então a segunda nunca trouxe nada de novo.
     */
    it('os consumidores da mesma requisição dividem uma leitura', async () => {
        AssetHistory.findOne.mockClear();
        const carregar = usdRateLoaderOnce(5.4);

        const [a, b, c] = await Promise.all([carregar(), carregar(), carregar()]);

        expect(AssetHistory.findOne).toHaveBeenCalledTimes(1);
        // É o MESMO resolvedor, não três cópias equivalentes.
        expect(a).toBe(b);
        expect(b).toBe(c);
    });

    // A carteira que não precisa do câmbio não paga por ele: o carregador só vai
    // ao banco quando alguém de fato o invoca.
    it('não lê nada enquanto ninguém pedir', () => {
        AssetHistory.findOne.mockClear();
        usdRateLoaderOnce(5.4);
        expect(AssetHistory.findOne).not.toHaveBeenCalled();
    });
});
