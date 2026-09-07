import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import axios from 'axios';
import { macroDataService, isPlausibleUsd, isPlausibleBtc } from '../services/macroDataService.js';
import { externalMarketService } from '../services/externalMarketService.js';
import AssetHistory from '../models/AssetHistory.js';
import { getEscalations, getSourceStats, resetSourceStats } from '../utils/sourceHealth.js';
import { buildEscalationView } from '../utils/dataSourceStatus.js';

// Incidente de 04/09/2026: a fonte de câmbio de então (AwesomeAPI) parou de
// responder, o `catch` vazio devolvia null, o gravador preservava o valor
// anterior e `lastUpdated` era carimbado assim mesmo. Dólar e BTC ficaram um dia
// inteiro no fechamento da véspera — na barra de indicadores E no multiplicador
// de posição dolarizada — sem log, sem flag e sem alarme. O contrato abaixo é o
// que impede a repetição.
//
// A ordem da cadeia (Yahoo → Coinbase → PTAX → Coinbase taxas) é deliberada e
// está coberta: as duas do meio são especialistas de uma moeda só, e existem
// porque a chamada de câmbio do Yahoo já falhou a partir do host de produção. A
// última cobre as duas moedas e vem depois delas mesmo assim, porque é a única
// que não mede a variação — deriva.
//
// A AwesomeAPI foi REMOVIDA da cadeia em 05/09/2026: respondia da máquina do
// desenvolvedor e nunca a partir do host. O que sobrou dela aqui é a memória do
// incidente, não um elo.

const yahooBody = {
    usd: { value: 5.13, change: 0.5 },
    btc: { value: 79000, change: -2.1 },
};

describe('updateCurrencies — cadeia de fontes', () => {
    afterEach(() => vi.restoreAllMocks());

    it('Yahoo no ar → resolve tudo e nem chega nos especialistas', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue(yahooBody);
        const coinbase = vi.spyOn(macroDataService, '_fetchBtcCoinbase');
        const ptax = vi.spyOn(macroDataService, '_fetchPtaxUsd');
        const rates = vi.spyOn(macroDataService, '_fetchCurrenciesCoinbaseRates');

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBe(5.13);
        expect(out.btc).toBe(79000);
        expect(out.usdSource).toBe('Yahoo');
        expect(out.btcSource).toBe('Yahoo');
        expect(coinbase).not.toHaveBeenCalled();
        expect(ptax).not.toHaveBeenCalled();
        expect(rates).not.toHaveBeenCalled();
    });

    // A janela que o 4º elo existe para cobrir: manhã, Yahoo fora e PTAX ainda
    // não publicada. Antes dele o dólar ficava `null` até as ~13h, e com ele o
    // multiplicador de posição dolarizada continua sendo o de hoje.
    it('manhã sem Yahoo e sem PTAX → a Coinbase de taxas cobre o dólar', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue(null);
        vi.spyOn(macroDataService, '_fetchPtaxUsd').mockResolvedValue(null);
        vi.spyOn(macroDataService, '_fetchCurrenciesCoinbaseRates')
            .mockResolvedValue({ usd: 5.127075, usdChange: 0.3, btc: 79997.92, btcChange: -1.2 });

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBeCloseTo(5.127075, 6);
        expect(out.usdSource).toBe('Coinbase (taxas)');
        expect(out.btcSource).toBe('Coinbase (taxas)');
    });

    it('Yahoo fora → cada especialista cobre a sua moeda e a fonte fica declarada', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue({ btc: 79533.56, btcChange: -2.13 });
        vi.spyOn(macroDataService, '_fetchPtaxUsd').mockResolvedValue({ usd: 5.1263, usdChange: 0.51 });

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBeCloseTo(5.1263, 4);
        expect(out.btc).toBeCloseTo(79533.56, 2);
        expect(out.usdSource).toBe('PTAX/BCB');
        expect(out.btcSource).toBe('Coinbase');
    });

    it('cobertura parcial: cada moeda guarda a sua própria fonte', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({ usd: yahooBody.usd });
        vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue({ btc: 79533.56, btcChange: -2.13 });
        const ptax = vi.spyOn(macroDataService, '_fetchPtaxUsd');

        const out = await macroDataService.updateCurrencies();

        expect(out.usdSource).toBe('Yahoo');     // primária resolveu o dólar
        expect(out.btcSource).toBe('Coinbase');  // e o especialista completou o BTC
        // Com as duas moedas resolvidas, a cadeia para: o elo seguinte nem é chamado.
        expect(ptax).not.toHaveBeenCalled();
    });

    // O ponto do incidente: sem valor de hoje, o retorno é `null` — nunca o
    // valor da véspera disfarçado de cotação. Quem grava é que decide preservar
    // o último conhecido, e marca isso como defasado.
    it('cadeia inteira fora → null nas duas moedas, sem número inventado', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('ETIMEDOUT'));

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBeNull();
        expect(out.btc).toBeNull();
        expect(out.usdSource).toBeNull();
        expect(out.btcSource).toBeNull();
    });

    it('valor implausível da primária é rejeitado e o elo seguinte assume', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({
            usd: { value: 0, change: 0 },   // fonte devolveu lixo
            btc: yahooBody.btc,
        });
        vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue({ btc: 79533.56, btcChange: -2.13 });
        vi.spyOn(macroDataService, '_fetchPtaxUsd').mockResolvedValue({ usd: 5.1263, usdChange: 0.51 });

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBeCloseTo(5.1263, 4);
        expect(out.usdSource).toBe('PTAX/BCB');
        expect(out.btcSource).toBe('Yahoo'); // o BTC da primária estava bom
    });
});

/**
 * O CAMINHO DE CADA MOEDA, no painel de fontes.
 *
 * O bloco de câmbio mostrava os quatro cards verdes e não sabia dizer quem
 * trouxe o dólar e quem trouxe o Bitcoin — que é exatamente o incidente de
 * 04/09/2026 que fez o painel nascer. Três dos quatro ficavam verdes por terem
 * sido chamados e respondido, não por estarem entregando.
 *
 * O detalhe que decide o desenho: aqui uma fonte cobre METADE. A Coinbase só
 * resolve BTC, a PTAX só o dólar — a trilha é acumulada por MOEDA, e só com quem
 * cobre aquela moeda. Registrar por chamada faria a PTAX aparecer como
 * tentada-e-falhada no Bitcoin, que ela nunca teve como cotar.
 */
describe('updateCurrencies — o que o painel aprende com a cadeia', () => {
    beforeEach(() => resetSourceStats());
    afterEach(() => vi.restoreAllMocks());

    it('Yahoo cobrindo tudo não gera escalada: o ledger é de quem precisou de reserva', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue(yahooBody);
        await macroDataService.updateCurrencies();
        expect(getEscalations()).toHaveLength(0);
    });

    it('cada moeda registra só as fontes que tinham como cotá-la', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue({ btc: 79533.56, btcChange: -2.13 });
        vi.spyOn(macroDataService, '_fetchPtaxUsd').mockResolvedValue({ usd: 5.1263, usdChange: 0.51 });

        await macroDataService.updateCurrencies();

        const porMoeda = new Map(getEscalations().map((e) => [e.subject, e]));
        // A PTAX não aparece no caminho do Bitcoin, e a Coinbase não aparece no
        // do dólar: nenhuma das duas foi capaz de cotar a outra moeda.
        expect(porMoeda.get('USD').tried).toEqual(['yahoo.currencies', 'ptax']);
        expect(porMoeda.get('USD').resolvedBy).toBe('ptax');
        expect(porMoeda.get('BTC').tried).toEqual(['yahoo.currencies', 'coinbase']);
        expect(porMoeda.get('BTC').resolvedBy).toBe('coinbase');
    });

    it('moeda resolvida pela primária não entra, mesmo quando a outra escala', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({ usd: yahooBody.usd });
        vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue({ btc: 79533.56, btcChange: -2.13 });

        await macroDataService.updateCurrencies();

        expect(getEscalations().map((e) => e.subject)).toEqual(['BTC']);
    });

    // O caso com consequência: sem cotação de hoje, o valor da véspera é
    // preservado e a tela precisa poder dizer QUAL moeda ficou para trás.
    it('cadeia inteira fora → as duas moedas ficam sem quem as resolva', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('ETIMEDOUT'));

        await macroDataService.updateCurrencies();

        const { chains } = buildEscalationView(getEscalations(), getSourceStats());
        expect(chains.fx.total).toBe(2);
        expect(chains.fx.unresolved).toBe(2);
        expect(chains.fx.vocabulary.missingBadge).toBe('sem cotação');
        // A trilha do dólar passa pelos três elos que cotam dólar; a do BTC, pelos
        // três que cotam BTC — e a soma é o que o card de cada fonte vai mostrar.
        const usd = getEscalations().find((e) => e.subject === 'USD');
        expect(usd.tried).toEqual(['yahoo.currencies', 'ptax', 'coinbase.rates']);
    });
});

describe('_fetchBtcCoinbase — rede final do bitcoin', () => {
    afterEach(() => vi.restoreAllMocks());

    it('deriva a variação de 24h da abertura da própria janela', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { last: '79762.41', open: '81771.62' } });

        const out = await macroDataService._fetchBtcCoinbase();

        expect(out.btc).toBeCloseTo(79762.41, 2);
        expect(out.btcChange).toBeCloseTo(-2.457, 2);
    });

    it('sem abertura utilizável, entrega o preço e variação zero em vez de NaN', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { last: '79762.41', open: '0' } });
        const out = await macroDataService._fetchBtcCoinbase();
        expect(out.btc).toBeCloseTo(79762.41, 2);
        expect(out.btcChange).toBe(0);
    });

    it('corpo inesperado vira null, não exceção', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { message: 'NotFound' } });
        await expect(macroDataService._fetchBtcCoinbase()).resolves.toBeNull();
    });

    // O buraco que ela fecha: em 04/09/2026 o câmbio do Yahoo falhou a partir do
    // host e o BTC ficou sem ninguém — a PTAX cobre só dólar.
    it('na cadeia, cobre o BTC quando o Yahoo cai', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue({ btc: 79762.41, btcChange: -2.45 });
        vi.spyOn(macroDataService, '_fetchPtaxUsd').mockResolvedValue({ usd: 5.1253, usdChange: 0.57 });

        const out = await macroDataService.updateCurrencies();

        expect(out.btcSource).toBe('Coinbase');
        expect(out.usdSource).toBe('PTAX/BCB');
        expect(out.btc).toBeCloseTo(79762.41, 2);
        expect(out.usd).toBe(5.1253);
    });
});

describe('_fetchPtaxUsd — rede final, só dólar e só do dia', () => {
    afterEach(() => vi.restoreAllMocks());

    const ptax = (dia, venda) => ({ dataHoraCotacao: `${dia} 13:03:59.556874`, cotacaoVenda: venda });
    const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

    it('fixação de hoje é aceita, com a variação medida sobre a anterior', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({
            data: { value: [ptax('2026-09-03', 5.0962), ptax(hojeBr(), 5.1253)] },
        });

        const out = await macroDataService._fetchPtaxUsd();

        expect(out.usd).toBe(5.1253);
        expect(out.usdChange).toBeCloseTo(0.571, 2); // 5,1253 / 5,0962 − 1
    });

    // A PTAX é FIXAÇÃO, não cotação viva: o boletim sai ~13h BRT e antes disso o
    // dia corrente não existe na série. Servir a última linha disponível seria
    // exatamente o defeito de 04/09/2026 — câmbio de ontem com cara de hoje.
    it('fixação de ontem é RECUSADA em vez de virar cotação de hoje', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({
            data: { value: [ptax('2026-09-02', 5.1273), ptax('2026-09-03', 5.0962)] },
        });

        await expect(macroDataService._fetchPtaxUsd()).resolves.toBeNull();
    });

    it('série vazia vira null, não exceção', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { value: [] } });
        await expect(macroDataService._fetchPtaxUsd()).resolves.toBeNull();
    });

    it('na cadeia, cobre o dólar e deixa o BTC declaradamente ausente', async () => {
        vi.spyOn(externalMarketService, 'getCurrencyQuotes').mockResolvedValue({});
        vi.spyOn(macroDataService, '_fetchBtcCoinbase').mockResolvedValue(null);
        vi.spyOn(axios, 'get').mockResolvedValue({
            data: { value: [ptax('2026-09-03', 5.0962), ptax(hojeBr(), 5.1253)] },
        });

        const out = await macroDataService.updateCurrencies();

        expect(out.usd).toBe(5.1253);
        expect(out.usdSource).toBe('PTAX/BCB');
        expect(out.btc).toBeNull();      // o BCB não cota cripto
        expect(out.btcSource).toBeNull();
    });
});

describe('_fetchCurrenciesCoinbaseRates — último recurso, as duas moedas', () => {
    afterEach(() => vi.restoreAllMocks());

    const serie = (history) => vi.spyOn(AssetHistory, 'findOne').mockReturnValue({
        select: () => ({ lean: async () => ({ history }) }),
    });

    // `rates.BRL` é quanto vale 1 dólar; `rates.BTC` é quantos BITCOINS valem 1
    // dólar — o preço do BTC sai do inverso, e trocar isso por leitura direta
    // gravaria 0,0000125 como cotação do bitcoin.
    it('lê o dólar direto e o bitcoin pelo INVERSO da taxa', async () => {
        serie([{ date: '2026-09-04', close: 5.1 }]);
        vi.spyOn(axios, 'get').mockResolvedValue({
            data: { data: { currency: 'USD', rates: { BRL: '5.127075', BTC: '0.0000125003250085' } } },
        });

        const out = await macroDataService._fetchCurrenciesCoinbaseRates();

        expect(out.usd).toBeCloseTo(5.127075, 6);
        expect(out.btc).toBeCloseTo(79997.92, 1);
    });

    it('sem BTC utilizável, o dólar ainda passa e a cripto sai declaradamente ausente', async () => {
        serie([{ date: '2026-09-04', close: 5.1 }]);
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { data: { rates: { BRL: '5.127075' } } } });

        const out = await macroDataService._fetchCurrenciesCoinbaseRates();

        expect(out.usd).toBeCloseTo(5.127075, 6);
        expect(Number.isFinite(out.btc)).toBe(false);  // e o chamador filtra por plausibilidade
    });

    it('corpo inesperado vira null, não exceção', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ data: { errors: [{ id: 'not_found' }] } });
        await expect(macroDataService._fetchCurrenciesCoinbaseRates()).resolves.toBeNull();
    });
});

describe('_changeVsPreviousClose — a variação que a fonte não mede', () => {
    afterEach(() => vi.restoreAllMocks());

    const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const serie = (history) => vi.spyOn(AssetHistory, 'findOne').mockReturnValue({
        select: () => ({ lean: async () => ({ history }) }),
    });

    it('mede contra o último fechamento anterior', async () => {
        serie([{ date: '2026-09-03', close: 5.0 }, { date: '2026-09-04', close: 5.1 }]);
        await expect(macroDataService._changeVsPreviousClose('USD-BRL', 5.151)).resolves.toBeCloseTo(1.0, 3);
    });

    // O candle de HOJE já pode estar gravado (worker das 18:30, fx-history das
    // 19:45). Medir o preço contra ele mesmo devolveria ~0% justamente no dia de
    // maior movimento — uma variação plausível e falsa, que é o pior tipo.
    it('IGNORA o candle de hoje, mesmo já gravado', async () => {
        serie([{ date: '2026-09-04', close: 5.0 }, { date: hojeBr(), close: 5.151 }]);
        await expect(macroDataService._changeVsPreviousClose('USD-BRL', 5.151)).resolves.toBeCloseTo(3.02, 2);
    });

    it('série ausente ou banco fora → 0, e o preço segue valendo', async () => {
        vi.spyOn(AssetHistory, 'findOne').mockReturnValue({
            select: () => ({ lean: async () => null }),
        });
        await expect(macroDataService._changeVsPreviousClose('BTC-USD', 79997.92)).resolves.toBe(0);

        vi.spyOn(AssetHistory, 'findOne').mockImplementation(() => { throw new Error('sem conexão'); });
        await expect(macroDataService._changeVsPreviousClose('BTC-USD', 79997.92)).resolves.toBe(0);
    });
});

describe('faixas de plausibilidade das moedas', () => {
    it('barra o que não pode virar multiplicador de patrimônio', () => {
        expect(isPlausibleUsd(5.1263)).toBe(true);
        expect(isPlausibleUsd(0)).toBe(false);
        expect(isPlausibleUsd(NaN)).toBe(false);
        expect(isPlausibleUsd(120)).toBe(false);

        expect(isPlausibleBtc(79533.56)).toBe(true);
        expect(isPlausibleBtc(0)).toBe(false);
        expect(isPlausibleBtc(12)).toBe(false);
    });
});
