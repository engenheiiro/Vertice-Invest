import { describe, it, expect } from 'vitest';
import { buildUsdRateResolver, effectiveFxRate, positionCostBRL, positionRealizedProfitBRL } from '../utils/fxRate.js';
import { processWalletAsset } from '../controllers/walletController.js';
import { sumTransactionFlowBRL } from '../utils/walletSnapshot.js';

// Regressão do custo cambial: o custo de uma posição em dólar era reconvertido
// pela cotação de HOJE, a mesma que converte o saldo. As duas pontas se
// cancelavam e o que aparecia na carteira era o retorno em DÓLAR — um USDC
// (pareado em US$1) ficava em 0,00% para sempre, e cripto em alta com o dólar
// subindo aparecia no vermelho. O câmbio da compra tem que ficar congelado.

const HISTORY = [
    { date: '2026-07-06', close: 5.1436 },
    { date: '2026-07-30', close: 5.0781 },
    { date: '2026-08-10', close: 5.0843 },
];

describe('buildUsdRateResolver', () => {
    const resolve = buildUsdRateResolver(HISTORY, 5.1904);

    it('devolve a taxa exata do dia quando existe candle', () => {
        expect(resolve('2026-07-30')).toBe(5.0781);
    });

    it('data sem candle (fim de semana/feriado) usa a última taxa ANTERIOR', () => {
        expect(resolve('2026-08-02')).toBe(5.0781);
    });

    it('data anterior a todo o histórico usa a primeira taxa conhecida, não a de hoje', () => {
        expect(resolve('2020-01-01')).toBe(5.1436);
    });

    it('data posterior ao último candle usa a cotação corrente', () => {
        // A série fecha com 1-3 dias de atraso: uma compra de HOJE não pode nascer
        // com o câmbio da semana passada gravado no custo.
        expect(resolve('2026-08-13')).toBe(5.1904);
    });

    it('sem cotação corrente confiável, cai no último candle em vez de inventar taxa', () => {
        const semSpot = buildUsdRateResolver(HISTORY, null);
        expect(semSpot('2026-08-13')).toBe(5.0843);
    });

    it('sem histórico algum, usa a cotação corrente', () => {
        expect(buildUsdRateResolver([], 5.1904)('2026-08-13')).toBe(5.1904);
    });

    it('ignora candles corrompidos (taxa zero/negativa/data inválida)', () => {
        const sujo = buildUsdRateResolver(
            [...HISTORY, { date: '2026-08-11', close: 0 }, { date: 'ontem', close: 9 }],
            null,
        );
        expect(sujo('2026-08-11')).toBe(5.0843);
    });

    it('rejeita data malformada em vez de devolver taxa silenciosamente errada', () => {
        expect(() => resolve('13/08/2026')).toThrow(RangeError);
    });
});

describe('effectiveFxRate', () => {
    const resolve = buildUsdRateResolver(HISTORY, 5.1904);

    it('câmbio carimbado no lançamento vence a reconstrução histórica', () => {
        const tx = { date: new Date('2026-07-30T12:00:00Z'), fxRate: 5.4321 };
        expect(effectiveFxRate(tx, 'USD', resolve)).toBe(5.4321);
    });

    it('lançamento legado (sem carimbo) reconstrói pela data', () => {
        const tx = { date: new Date('2026-07-30T12:00:00Z') };
        expect(effectiveFxRate(tx, 'USD', resolve)).toBe(5.0781);
    });

    it('posição em real é sempre 1 — nunca consulta o resolvedor', () => {
        const explode = () => { throw new Error('não deveria resolver câmbio para BRL'); };
        expect(effectiveFxRate({ date: new Date() }, 'BRL', explode)).toBe(1);
    });
});

describe('positionCostBRL — precedência e fallback', () => {
    it('usa o custo em BRL acumulado quando a posição já foi migrada', () => {
        const asset = { type: 'CRYPTO', currency: 'USD', totalCost: 1.4, totalCostBrl: 7.11 };
        expect(positionCostBRL(asset, 5.1904)).toBe(7.11);
    });

    it('posição legada (totalCostBrl null) mantém o comportamento antigo', () => {
        const asset = { type: 'CRYPTO', currency: 'USD', totalCost: 1.4, totalCostBrl: null };
        expect(positionCostBRL(asset, 5)).toBe(7);
    });

    it('custo zero migrado NÃO é confundido com posição legada', () => {
        // Number(null) é 0 e finito: um teste ingênuo trataria "migrado com custo
        // zero" e "não migrado" como o mesmo caso e reconverteria pelo câmbio.
        const asset = { type: 'CRYPTO', currency: 'USD', totalCost: 0, totalCostBrl: 0 };
        expect(positionCostBRL(asset, 5.1904)).toBe(0);
    });

    it('posição em real não é multiplicada por câmbio nem quando não migrada', () => {
        const asset = { type: 'STOCK', currency: 'BRL', totalCost: 37.76, totalCostBrl: null };
        expect(positionCostBRL(asset, 5.1904)).toBe(37.76);
    });

    it('lucro realizado segue a mesma precedência', () => {
        expect(positionRealizedProfitBRL({ type: 'CRYPTO', realizedProfit: 2, realizedProfitBrl: 9.5 }, 5)).toBe(9.5);
        expect(positionRealizedProfitBRL({ type: 'CRYPTO', realizedProfit: 2, realizedProfitBrl: null }, 5)).toBe(10);
    });
});

describe('processWalletAsset — resultado cambial de posição em dólar', () => {
    const ctx = {
        assetMap: new Map([
            ['USDC', { price: 0.9999, change: 0.0039, name: 'USD Coin' }],
            ['BTC', { price: 63755.69, change: 0.6127, name: 'Bitcoin' }],
        ]),
        usdRate: 5.1904,
        usdChange: 0.6418,
        macroRates: { cdiRate: 13.9, selic: 14, ipca: 4.44 },
        isTodayBusinessDay: true,
    };

    // Caso real que originou a investigação: 1,4 USDC comprado a US$1,00 em
    // 30/07 com dólar a 5,0781, avaliado com dólar a 5,1904.
    const usdc = {
        ticker: 'USDC',
        type: 'CRYPTO',
        currency: 'USD',
        quantity: 1.4,
        totalCost: 1.4,
        totalCostBrl: 7.11,
        realizedProfit: 0,
        realizedProfitBrl: 0,
        taxLots: [{ date: new Date('2026-07-30T12:00:00.000Z'), quantity: 1.4, price: 1, fxRate: 5.0781 }],
    };

    it('stablecoin deixa de ficar travado em 0,00% e mostra o ganho cambial', () => {
        const { processed } = processWalletAsset(usdc, ctx);

        expect(processed.totalCost).toBe(7.11);
        expect(processed.totalValue).toBeCloseTo(7.27, 2);
        expect(processed.profit).toBeCloseTo(0.16, 2);
        expect(processed.profitPercent).toBeCloseTo(2.2, 1);
    });

    it('posição legada continua exibindo 0,00% (fallback preservado, sem quebrar)', () => {
        const legado = { ...usdc, totalCostBrl: null, realizedProfitBrl: null };
        const { processed } = processWalletAsset(legado, ctx);

        expect(processed.profitPercent).toBeCloseTo(0, 1);
    });

    it('cripto em alta no câmbio não aparece mais como prejuízo', () => {
        // BTC: custo US$32,33 pago a ~5,08 → em dólar está no vermelho, mas em
        // reais o câmbio virou o resultado.
        const btc = {
            ticker: 'BTC',
            type: 'CRYPTO',
            currency: 'USD',
            quantity: 0.0005014,
            totalCost: 32.33,
            totalCostBrl: 164.36,
            realizedProfit: 0,
            realizedProfitBrl: 0,
            taxLots: [{ date: new Date('2026-07-30T12:00:00.000Z'), quantity: 0.0005014, price: 64479.46, fxRate: 5.0781 }],
        };
        const { processed } = processWalletAsset(btc, ctx);

        expect(processed.profit).toBeGreaterThan(0);
        // O mesmo ativo pelo cálculo antigo (custo × dólar de hoje) daria prejuízo.
        expect(processed.totalValue - 32.33 * ctx.usdRate).toBeLessThan(0);
    });

    it('percentual do ativo é o retorno da posição, não o retorno menos 100', () => {
        // calculatePercent(atual, inicial) espera dois VALORES; passar o lucro
        // como "atual" devolvia lucro/custo − 100 (PETR4 com +10% saía −89,99%).
        const petr = {
            ticker: 'PETR4',
            type: 'STOCK',
            currency: 'BRL',
            quantity: 1,
            totalCost: 37.76,
            totalCostBrl: 37.76,
            realizedProfit: 0,
            realizedProfitBrl: 0,
            taxLots: [{ date: new Date('2026-05-02T12:00:00.000Z'), quantity: 1, price: 37.76, fxRate: 1 }],
        };
        const ctxBr = { ...ctx, assetMap: new Map([['PETR4', { price: 41.54, change: 0.2171 }]]) };
        const { processed } = processWalletAsset(petr, ctxBr);

        expect(processed.profitPercent).toBeCloseTo(10.01, 1);
    });

    it('lucro realizado entra no percentual pelo câmbio das vendas', () => {
        const comVenda = { ...usdc, realizedProfit: 1, realizedProfitBrl: 5.2 };
        const { processed } = processWalletAsset(comVenda, ctx);

        expect(processed.profit).toBeCloseTo(0.16 + 5.2, 2);
        // (saldo + realizado) / custo − 1
        expect(processed.profitPercent).toBeCloseTo(((7.27 + 5.2) / 7.11 - 1) * 100, 0);
    });

    it('variação do DIA continua incluindo o câmbio (não regrediu)', () => {
        const { processed } = processWalletAsset(usdc, ctx);
        // Preço em dólar parado + dólar +0,64% no dia.
        expect(processed.dayChangePct).toBeCloseTo(0.646, 1);
    });
});

describe('sumTransactionFlowBRL — coerência com o custo da posição', () => {
    const assets = new Map([['BTC', { type: 'CRYPTO', currency: 'USD' }]]);

    it('usa o câmbio carimbado no lançamento em vez de reconstruir por data', () => {
        const txs = [{ ticker: 'BTC', type: 'BUY', totalValue: 100, date: new Date('2026-07-30T12:00:00Z'), currency: 'USD', fxRate: 5.0781 }];
        // Resolvedor devolveria outra taxa; o carimbo tem que vencer, senão o
        // fluxo do TWRR e o custo da posição divergem para o mesmo aporte.
        expect(sumTransactionFlowBRL(txs, assets, () => 9.99)).toBeCloseTo(507.81, 2);
    });

    it('lançamento legado ainda cai no resolvedor por data', () => {
        const txs = [{ ticker: 'BTC', type: 'BUY', totalValue: 100, date: new Date('2026-07-30T12:00:00Z'), currency: 'USD' }];
        expect(sumTransactionFlowBRL(txs, assets, () => 5.0781)).toBeCloseTo(507.81, 2);
    });

    it('câmbio carimbado inválido não passa despercebido', () => {
        const txs = [{ ticker: 'BTC', type: 'BUY', totalValue: 100, date: new Date('2026-07-30T12:00:00Z'), currency: 'USD', fxRate: 0 }];
        expect(() => sumTransactionFlowBRL(txs, assets, () => 0)).toThrow(RangeError);
    });
});
