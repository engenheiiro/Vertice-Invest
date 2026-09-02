/**
 * Detalhamento da Variação Hoje: a contribuição de CADA posição e a régua que a
 * produziu.
 *
 * Duas propriedades sustentam o painel, e as duas são fáceis de perder numa
 * refatoração distraída:
 *
 *  1) A SOMA DAS LINHAS É O CARD. `dayChangeValue` é o mesmo número que
 *     `buildWalletPayload` acumula em `dayVariation` — não uma segunda conta feita
 *     em paralelo. Recalcular a variação por outra régua é exatamente como o card
 *     e o gráfico voltaram a discordar em 01/09/2026 (ver day_variation_anchor).
 *
 *  2) O MOTIVO SEGUE O NÚMERO. `dayChangeReason` tem de nomear o ramo que
 *     realmente produziu `dayChangePct`, inclusive nas sobrescritas. Um motivo
 *     fora de ordem faz a linha exibir um valor e explicar outro — pior que não
 *     explicar nada.
 */
import { describe, it, expect } from 'vitest';
import { processWalletAsset } from '../controllers/walletController.js';
import { financialService } from '../services/financialService.js';
import { DAY_CHANGE_REASON, isDefaultDayChangeReason, ZEROED_BY_DATA_REASONS } from '../utils/dayChangeReason.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import { brazilToday, PRICING_SOURCE } from '../utils/fixedIncome.js';
import { reconcileRoundedParts, safeCurrency, safeAdd } from '../utils/mathUtils.js';

const macroRates = { cdiRate: 13.9, selic: 14.0, ipca: 4.72 };
const HOJE = '2026-09-01';   // terça-feira
const ANCORA = '2026-08-31'; // segunda-feira

const baseCtx = (overrides = {}) => ({
    assetMap: new Map(),
    usdRate: 5.185,
    usdChange: 0.4436,
    macroRates,
    isTodayBusinessDay: true,
    todayKey: HOJE,
    anchorDayKey: ANCORA,
    anchorCloses: new Map(),
    anchorUsdRate: 5.17,
    ...overrides,
});

const stock = (over = {}) => ({
    ticker: 'PETR4', type: 'STOCK', quantity: 100, totalCost: 3000, currency: 'BRL',
    taxLots: [{ date: new Date('2026-05-10T00:00:00.000Z'), quantity: 100, price: 30 }],
    ...over,
});

const quote = (over = {}) => ({ price: 32, previousClose: 31.5, change: 1.59, priceDate: HOJE, ...over });

const closes = (asset, close) => new Map([[historyStorageKey(asset.ticker, asset.type), close]]);

// ───────────────────────────────────────────────────────────────────────────────

describe('motivo da variação — mercado', () => {
    it('candle do dia-âncora é o caso normal e NÃO recebe etiqueta', () => {
        const a = stock();
        const { processed } = processWalletAsset(a, baseCtx({
            assetMap: new Map([['PETR4', quote()]]),
            anchorCloses: closes(a, 31),
        }));

        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.ANCHOR_CLOSE);
        expect(isDefaultDayChangeReason(processed.dayChangeReason)).toBe(true);
        // 100 × (32 − 31) = 100,00
        expect(processed.dayChangeValue).toBe(100);
    });

    it('comprado hoje sobrescreve o candle-âncora: o início do dia vira o custo', () => {
        const a = stock({ taxLots: [{ date: new Date(`${HOJE}T14:00:00.000Z`), quantity: 100, price: 30 }] });
        const { processed } = processWalletAsset(a, baseCtx({
            assetMap: new Map([['PETR4', quote()]]),
            anchorCloses: closes(a, 31), // existe, e ainda assim perde
        }));

        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.BOUGHT_TODAY);
        // 100 × (32 − 30) = 200,00 — medido contra o preço médio, não contra o candle
        expect(processed.dayChangeValue).toBe(200);
    });

    it('cotação de sessão anterior zera a variação e diz por quê', () => {
        const { processed } = processWalletAsset(stock(), baseCtx({
            assetMap: new Map([['PETR4', quote({ priceDate: ANCORA })]]),
        }));

        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.STALE_QUOTE);
        expect(processed.dayChangeValue).toBe(0);
        // O zero é NOSSO (falta de dado), não do mercado: a linha fica visível.
        expect(ZEROED_BY_DATA_REASONS.has(processed.dayChangeReason)).toBe(true);
    });

    it('sem candle-âncora mas com a sessão de hoje, usa a variação do provedor', () => {
        const { processed } = processWalletAsset(stock(), baseCtx({
            assetMap: new Map([['PETR4', quote()]]),
        }));

        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.PROVIDER_SESSION);
        expect(processed.dayChangeValue).toBeGreaterThan(0);
    });

    it('ticker fora do cache de mercado é NO_QUOTE, não um zero mudo', () => {
        const { processed } = processWalletAsset(stock(), baseCtx());

        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.NO_QUOTE);
        expect(processed.dayChangeValue).toBe(0);
        expect(ZEROED_BY_DATA_REASONS.has(processed.dayChangeReason)).toBe(true);
    });
});

describe('motivo da variação — cripto', () => {
    const btc = (over = {}) => ({
        ticker: 'BTC', type: 'CRYPTO', quantity: 0.05, totalCost: 25000, currency: 'BRL',
        taxLots: [{ date: new Date('2026-06-01T00:00:00.000Z'), quantity: 0.05, price: 500000 }],
        ...over,
    });

    it('com candle gravado, cripto cai no caso normal como qualquer classe', () => {
        const a = btc();
        const { processed } = processWalletAsset(a, baseCtx({
            assetMap: new Map([['BTC', { price: 620000, previousClose: 610000, change: 3.2 }]]),
            anchorCloses: closes(a, 600000),
        }));

        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.ANCHOR_CLOSE);
    });

    it('sem candle, o fechamento anterior do provedor também é âncora fixa', () => {
        const { processed } = processWalletAsset(btc(), baseCtx({
            assetMap: new Map([['BTC', { price: 620000, previousClose: 610000, change: 3.2 }]]),
        }));

        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.PREVIOUS_CLOSE);
        expect(isDefaultDayChangeReason(processed.dayChangeReason)).toBe(true);
    });

    it('sem candle e sem fechamento anterior, sobra a janela de 24h — e ela é sinalizada', () => {
        const { processed } = processWalletAsset(btc(), baseCtx({
            assetMap: new Map([['BTC', { price: 620000, previousClose: 0, change: 3.2 }]]),
        }));

        // A janela deslizante do provedor responde outra pergunta ("quanto subiu nas
        // últimas 24h"), então o número é usável mas não é o mesmo "desde ontem".
        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.PROVIDER_WINDOW);
        expect(isDefaultDayChangeReason(processed.dayChangeReason)).toBe(false);
    });
});

describe('motivo da variação — renda fixa', () => {
    const DAY_MS = 86400000;
    const dayIso = (o) => new Date(brazilToday().getTime() + o * DAY_MS).toISOString().slice(0, 10);
    const dayDate = (o) => new Date(`${dayIso(o)}T00:00:00.000Z`);

    const serie = [
        { date: dayIso(-4), pu: 1000, puBuy: 1010 },
        { date: dayIso(-2), pu: 1050, puBuy: 1060 },
        { date: dayIso(-1), pu: 1080, puBuy: 1090 },
        { date: dayIso(0), pu: 1111, puBuy: 1121 },
    ];

    const titulo = (over = {}) => ({
        type: 'FIXED_INCOME', ticker: 'TESOURO IPCA+ 2035', quantity: 1, totalCost: 1000,
        currency: 'BRL', taxLots: [{ date: dayDate(-4), quantity: 1, price: 1000 }],
        ...over,
    });

    const pricingFor = (h) => ({ historyFor: () => h, resolve: () => ({ key: 'IPCA|2035-05-15' }), catalog: [], series: new Map() });
    // Sem anchorDayKey: isola a régua da FONTE do preço, sem a remedição pela âncora.
    const rfCtx = (h) => baseCtx({ todayKey: dayIso(0), anchorDayKey: null, treasuryPricing: pricingFor(h) });

    it('PU oficial publicado HOJE → marcado a mercado', () => {
        const { processed } = processWalletAsset(titulo(), rfCtx(serie));

        expect(processed.pricingSource).toBe(PRICING_SOURCE.MTM);
        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.FIXED_INCOME_MTM);
        expect(processed.dayChangeValue).not.toBe(0);
    });

    it('PU mais recente é de outro dia → PENDING, com a variação zerada', () => {
        const { processed } = processWalletAsset(titulo(), rfCtx(serie.slice(0, -1)));

        // Segue marcado (o valor é o do último PU), mas a variação do DIA é zero:
        // repeti-la mostraria um movimento que não aconteceu hoje.
        expect(processed.pricingSource).toBe(PRICING_SOURCE.MTM);
        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.FIXED_INCOME_MTM_PENDING);
        expect(processed.dayChangeValue).toBe(0);
        expect(ZEROED_BY_DATA_REASONS.has(processed.dayChangeReason)).toBe(true);
    });

    it('sem série de PU, a posição fica na curva', () => {
        const { processed } = processWalletAsset(titulo(), rfCtx(null));

        expect(processed.pricingSource).toBe(PRICING_SOURCE.ACCRUAL);
        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.FIXED_INCOME_CURVE);
    });

    it('na curva, comprado hoje zera o dia e sobrescreve a etiqueta', () => {
        const hoje = titulo({ taxLots: [{ date: dayDate(0), quantity: 1, price: 1000 }] });
        const { processed } = processWalletAsset(hoje, rfCtx(null));

        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.BOUGHT_TODAY);
        expect(processed.dayChangeValue).toBe(0);
    });

    it('no marcado a mercado, comprado hoje é COMPRA DO DIA — não PU atrasado', () => {
        // O ramo MTM não tem a guarda explícita de compra do dia; ele zera por
        // consequência (não existe marcação anterior de uma posição que não
        // existia). O motivo tem de nomear a causa REAL: rotular de
        // "PU de hoje não publicado" com o PU de hoje na série seria mentira.
        const hoje = titulo({ taxLots: [{ date: dayDate(0), quantity: 1, price: 1000 }] });
        const { processed } = processWalletAsset(hoje, rfCtx(serie));

        expect(processed.pricingSource).toBe(PRICING_SOURCE.MTM);
        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.BOUGHT_TODAY);
        expect(processed.dayChangeValue).toBe(0);
    });

    it('título vencido vence todas as outras etiquetas', () => {
        const vencido = titulo({ maturityDate: dayDate(-1) });
        const { processed } = processWalletAsset(vencido, rfCtx(serie));

        expect(processed.matured).toBe(true);
        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.MATURED);
        expect(processed.dayChangeValue).toBe(0);
    });

    it('vencido também vence a compra do dia (a última sobrescrita é a dele)', () => {
        const vencido = titulo({ maturityDate: dayDate(-1), taxLots: [{ date: dayDate(0), quantity: 1, price: 1000 }] });
        const { processed } = processWalletAsset(vencido, rfCtx(null));

        expect(processed.dayChangeReason).toBe(DAY_CHANGE_REASON.MATURED);
    });
});

describe('a soma das linhas é o card', () => {
    // Carteira mista: cada classe entra por um ramo diferente do cálculo.
    const carteira = [
        stock(),
        stock({ ticker: 'VALE3', quantity: 80, totalCost: 4800, taxLots: [{ date: new Date('2026-04-02T00:00:00.000Z'), quantity: 80, price: 60 }] }),
        { ticker: 'NVDA', type: 'STOCK_US', quantity: 3, totalCost: 2400, currency: 'USD', totalCostBrl: 12000, taxLots: [{ date: new Date('2026-03-11T00:00:00.000Z'), quantity: 3, price: 800 }] },
        { ticker: 'BTC', type: 'CRYPTO', quantity: 0.05, totalCost: 25000, currency: 'BRL', taxLots: [{ date: new Date('2026-06-01T00:00:00.000Z'), quantity: 0.05, price: 500000 }] },
    ];

    const ctx = () => baseCtx({
        assetMap: new Map([
            ['PETR4', quote()],
            ['VALE3', quote({ price: 58.4, previousClose: 59, change: -1.02 })],
            ['NVDA', quote({ price: 905, previousClose: 890, change: 1.68 })],
            ['BTC', { price: 620000, previousClose: 610000, change: 3.2, priceDate: HOJE }],
        ]),
        anchorCloses: new Map([
            [historyStorageKey('PETR4', 'STOCK'), 31],
            [historyStorageKey('VALE3', 'STOCK'), 59.2],
            [historyStorageKey('NVDA', 'STOCK_US'), 890],
            [historyStorageKey('BTC', 'CRYPTO'), 600000],
        ]),
    });

    it('Σ dayChangeValue (reconciliado) === dayVariation do card, ao centavo', () => {
        const c = ctx();
        // Reproduz o laço de buildWalletPayload: soma os valores CRUS, arredonda no fim.
        let totalCru = 0;
        const partes = [];
        for (const a of carteira) {
            const { processed, dayChangeValueBr } = processWalletAsset(a, c);
            totalCru = safeAdd(totalCru, dayChangeValueBr);
            partes.push(processed.dayChangeValue);
        }
        const totalCard = safeCurrency(totalCru);

        const linhas = reconcileRoundedParts(partes, totalCard);
        const somaLinhas = linhas.reduce((acc, v) => safeAdd(acc, v), 0);

        expect(safeCurrency(somaLinhas)).toBe(totalCard);
    });

    it('há alta e queda na mesma carteira — o painel tem os dois lados para explicar', () => {
        const c = ctx();
        const valores = carteira.map((a) => processWalletAsset(a, c).processed.dayChangeValue);

        expect(valores.some((v) => v > 0)).toBe(true);
        expect(valores.some((v) => v < 0)).toBe(true);
    });

    it('todo ativo sai com um motivo — nunca null', () => {
        const c = ctx();
        for (const a of carteira) {
            const { processed } = processWalletAsset(a, c);
            expect(Object.values(DAY_CHANGE_REASON)).toContain(processed.dayChangeReason);
        }
    });
});

describe('reconcileRoundedParts', () => {
    it('joga o resíduo do arredondamento na parte de maior módulo', () => {
        // Arredondadas: 10,00 · 0,01 · −4,00 = 6,01. O total cru fecha em 6,00, e
        // esse centavo de sobra é exatamente o que apareceria entre as linhas e o card.
        const out = reconcileRoundedParts([10.004, 0.005, -4.005], 6.0);

        expect(out.reduce((a, b) => safeAdd(a, b), 0)).toBe(6.0);
        // A maior em módulo absorve o ajuste; as outras ficam como estavam.
        expect(out[0]).toBe(9.99);
        expect(out[1]).toBe(0.01);
        expect(out[2]).toBe(-4);
    });

    it('não mexe em nada quando as partes já fecham o total', () => {
        expect(reconcileRoundedParts([1.5, -0.5, 2], 3)).toEqual([1.5, -0.5, 2]);
    });

    it('lista vazia devolve lista vazia (carteira sem ativos)', () => {
        expect(reconcileRoundedParts([], 0)).toEqual([]);
        expect(reconcileRoundedParts(null, 12)).toEqual([]);
    });

    it('parte única absorve o total inteiro', () => {
        expect(reconcileRoundedParts([0.1], 0.25)).toEqual([0.25]);
    });

    it('empate de módulo resolve pelo primeiro — resultado determinístico', () => {
        expect(reconcileRoundedParts([2, -2], 0.03)).toEqual([2.03, -2]);
    });
});

describe('proventos da janela do dia', () => {
    // Puro: passando `transactions` e `dividendDateMap`, o accrual não vai ao banco.
    const tx = (ticker, day, quantity) => ({
        ticker, type: 'BUY', quantity, price: 10, date: new Date(`${day}T12:00:00.000Z`),
    });
    const call = (sinceDayKey) => financialService.accrueDividendsByTicker('u', 'w', HOJE, {
        sinceDayKey,
        transactions: [tx('KNCR11', '2026-07-01', 100), tx('MXRF11', '2026-07-01', 200)],
        dividendDateMap: new Map([
            ['2026-08-05', [{ ticker: 'KNCR11', amount: 1.1, paymentDate: new Date('2026-08-20') }]],
            [ANCORA, [{ ticker: 'MXRF11', amount: 0.1, paymentDate: new Date('2026-09-15') }]],
            [HOJE, [{ ticker: 'KNCR11', amount: 1.25, paymentDate: new Date('2026-09-15') }]],
        ]),
    });

    it('conta só as ex-dates POSTERIORES ao dia-âncora', async () => {
        const r = await call(ANCORA);

        // 100 × 1,25 do dia-ex de hoje. O de 05/08 e o do próprio dia-âncora ficam fora.
        expect(r.sinceTotal).toBe(125);
        expect(r.sinceByTicker).toEqual({ KNCR11: 125 });
    });

    it('sinceTotal é a soma exata do detalhe por ticker', async () => {
        const r = await call('2026-08-01');
        const soma = Object.values(r.sinceByTicker).reduce((a, b) => safeAdd(a, b), 0);
        expect(safeCurrency(soma)).toBe(r.sinceTotal);
    });

    it('sem âncora (carteira nova) devolve zero sem quebrar', async () => {
        const r = await call(null);
        expect(r.sinceTotal).toBe(0);
        expect(r.sinceByTicker).toEqual({});
    });

    it('não altera o acumulado all-time que o KPI já usava', async () => {
        const r = await call(ANCORA);
        // 100×1,10 + 200×0,10 + 100×1,25 = 110 + 20 + 125
        expect(r.total).toBe(255);
    });
});
