import { describe, it, expect } from 'vitest';
import { processWalletAsset } from '../controllers/walletController.js';
import {
    buildPublicScale, maskAsset, maskKpis, maskWalletPayload,
    maskHistory, maskPerformance, maskDividends, maskCashFlow,
} from '../utils/publicWalletMask.js';

/**
 * O link público renderiza a MESMA página Carteira. Quando o dono não libera os
 * valores em R$, esconder na tela não basta — a resposta da API é visível a
 * qualquer visitante. Estes testes travam as duas propriedades que sustentam
 * isso: nenhum valor real trafega, e o que a página desenha (pesos, curvas,
 * percentuais) continua exato.
 */

const EQUITY = 250_000;

const payload = () => ({
    assets: [
        {
            ticker: 'PETR4', type: 'STOCK', quantity: 1000, averagePrice: 30, currentPrice: 37.5,
            totalValue: 150_000, totalCost: 120_000, profit: 30_000, profitPercent: 25,
            dayChangePct: 1.2, dividendsReceived: 8_000, accruedValue: null,
            dayChangeValue: 1_800, dayDividends: 0, dayChangeReason: 'ANCHOR_CLOSE',
        },
        {
            ticker: 'MXRF11', type: 'FII', quantity: 10_000, averagePrice: 10, currentPrice: 10,
            totalValue: 100_000, totalCost: 100_000, profit: 0, profitPercent: 0,
            dayChangePct: 0, dividendsReceived: 4_000, accruedValue: null,
            dayChangeValue: -900, dayDividends: 1_100, dayChangeReason: 'ANCHOR_CLOSE',
        },
    ],
    kpis: {
        totalEquity: EQUITY, totalInvested: 220_000, totalResult: 30_000,
        totalResultPercent: 13.64, dayVariation: 900, dayVariationPercent: 0.36,
        dayAnchorDate: '2026-08-31', dayDividends: 1_100,
        totalDividends: 12_000, projectedDividends: 1_000,
        weightedRentability: 11.2, sharpeRatio: null, beta: 0.85,
    },
    targetAllocation: { STOCK: 60, FII: 40 },
    meta: { usdRate: 5.4 },
});

describe('carteira pública com valores liberados', () => {
    it('não altera nada — o visitante vê os mesmos números do dono', () => {
        const scale = buildPublicScale({ showValues: true, totalEquity: EQUITY });
        const p = payload();
        expect(scale.factor).toBe(1);
        expect(maskKpis(scale, p.kpis)).toEqual(p.kpis);
        expect(maskAsset(scale, p.assets[0])).toEqual(p.assets[0]);
    });
});

describe('carteira pública com valores ocultos', () => {
    const scale = () => buildPublicScale({ showValues: false, totalEquity: EQUITY });

    it('normaliza o patrimônio para 100 e preserva os percentuais', () => {
        const masked = maskKpis(scale(), payload().kpis);
        expect(masked.totalEquity).toBe(100);
        expect(masked.totalInvested).toBe(88);
        // Percentuais e métricas de risco passam intactos: são o que a página mostra.
        expect(masked.totalResultPercent).toBe(13.64);
        expect(masked.weightedRentability).toBe(11.2);
        expect(masked.beta).toBe(0.85);
        // null ≠ 0: "sem amostra para medir" não pode virar "risco zero".
        expect(masked.sharpeRatio).toBeNull();
    });

    it('preserva o peso de cada ativo na carteira', () => {
        const s = scale();
        const [petr, mxrf] = payload().assets.map((a) => maskAsset(s, a));
        expect(petr.totalValue / 100).toBeCloseTo(150_000 / EQUITY, 10);
        expect(mxrf.totalValue / 100).toBeCloseTo(100_000 / EQUITY, 10);
        expect(petr.profitPercent).toBe(25);
    });

    it('zera quantidade e preços — senão quantidade × preço devolveria o patrimônio', () => {
        const petr = maskAsset(scale(), payload().assets[0]);
        expect(petr.quantity).toBe(0);
        expect(petr.averagePrice).toBe(0);
        expect(petr.currentPrice).toBe(0);
    });

    it('não publica as metas da Carteira Ideal (é o plano do dono, não a carteira)', () => {
        const out = maskWalletPayload(scale(), payload());
        expect(out.targetAllocation).toBeUndefined();
        expect(Object.keys(out).sort()).toEqual(['assets', 'kpis', 'meta']);
    });

    it('nenhum valor real sobrevive em nenhuma aba', () => {
        const s = scale();
        const real = [250_000, 220_000, 150_000, 120_000, 30_000, 12_000, 8_000, 4_000, 1_800, 1_100, 1_000, 900, -900];
        const seen = [];
        const collect = (node) => {
            if (typeof node === 'number') seen.push(node);
            else if (Array.isArray(node)) node.forEach(collect);
            else if (node && typeof node === 'object') Object.values(node).forEach(collect);
        };

        collect(maskWalletPayload(s, payload()));
        collect(maskHistory(s, [{ date: '2026-08-01', totalEquity: 240_000, totalInvested: 220_000, totalDividends: 11_000, profit: 20_000, quotaPrice: 109.1 }]));
        collect(maskPerformance(s, {
            history: [{ date: '2026-08-01', wallet: 9.1, equity: 240_000, invested: 220_000, cdiValue: 230_000, ipcaValue: 231_000, ibovValue: 235_000 }],
            stats: { sharpe: 1.1 },
        }));
        collect(maskDividends(s, {
            history: [{ month: '2026-07', value: 1_000, breakdown: [{ ticker: 'PETR4', amount: 1_000 }] }],
            provisioned: [{ ticker: 'MXRF11', amount: 900 }],
            totalAllTime: 12_000, projectedMonthly: 1_000,
            yieldOnCost: [{ ticker: 'PETR4', receivedLast12Months: 8_000, totalCost: 120_000, yocPercent: 6.67 }],
            goal: { target: 2_000, current: 1_000, progressPercent: 50 },
        }));
        collect(maskCashFlow(s, {
            transactions: [{ ticker: 'PETR4', quantity: 1000, price: 30, totalValue: 30_000, fxRate: 5.4 }],
            pagination: { total: 1, hasMore: false },
        }));

        expect(seen.filter((v) => real.includes(v))).toEqual([]);
    });

    it('a variação do dia e o provento do dia-ex também são normalizados', () => {
        const s = scale();
        const [petr, mxrf] = payload().assets.map((a) => maskAsset(s, a));

        // Preservam o peso relativo, sem carregar um real verdadeiro.
        expect(petr.dayChangeValue / 100).toBeCloseTo(1_800 / EQUITY, 10);
        expect(mxrf.dayChangeValue / 100).toBeCloseTo(-900 / EQUITY, 10);
        expect(mxrf.dayDividends / 100).toBeCloseTo(1_100 / EQUITY, 10);
        // O motivo é rótulo, não valor: passa intacto (decisão consciente — ver
        // a catraca abaixo).
        expect(petr.dayChangeReason).toBe('ANCHOR_CLOSE');
        expect(maskKpis(s, payload().kpis).dayDividends / 100).toBeCloseTo(1_100 / EQUITY, 10);
        // Data não é valor: a âncora precisa chegar legível para a tela nomear o dia.
        expect(maskKpis(s, payload().kpis).dayAnchorDate).toBe('2026-08-31');
    });

    it('carteira sem patrimônio não divide por zero', () => {
        const s = buildPublicScale({ showValues: false, totalEquity: 0 });
        expect(s.factor).toBe(0);
        expect(maskKpis(s, { totalEquity: 0, totalInvested: 0 }).totalEquity).toBe(0);
    });
});

/**
 * CATRACA DOS CAMPOS DO ATIVO.
 *
 * A máscara é uma lista MANUAL de campos. Todo campo novo em `processWalletAsset`
 * entra na resposta pública por omissão — e um monetário esquecido aqui não
 * "vaza um número": ele devolve o FATOR de normalização, e com o fator o
 * patrimônio real do dono, que é justamente o que o link com valores ocultos
 * promete não entregar.
 *
 * Este teste não sabe o que é sensível; ele obriga quem adicionar um campo a
 * PARAR e decidir. Se ele quebrou:
 *   1. o campo é monetário  → some `money(scale, ...)` em `maskAsset`;
 *   2. quantidade ou preço  → `hidden(scale, ...)` (reconstruiriam o fator);
 *   3. rótulo, data, flag   → passa intacto;
 *   e então acrescente o nome à lista abaixo.
 */
describe('catraca: nenhum campo novo escapa da decisão de máscara', () => {
    const CAMPOS_DO_ATIVO = [
        'accruedValue', 'allocationClass', 'averagePrice', 'currency', 'currentPrice',
        'dayChangePct', 'dayChangeReason', 'dayChangeValue', 'dayDividends',
        'dividendsReceived', 'fixedIncomeIndex', 'fixedIncomeRate', 'id', 'isReserve',
        'matured', 'maturityDate', 'name', 'priceDate', 'pricingSource', 'profit',
        'profitPercent', 'quantity', 'sector', 'tags', 'ticker', 'totalCost',
        'totalValue', 'treasuryAverageUnitPrice', 'treasuryUnitPrice', 'treasuryUnits',
        'type', 'usSubType',
    ];

    it('a lista revisada cobre todos os campos que o ativo publica', () => {
        const { processed } = processWalletAsset(
            {
                ticker: 'PETR4', type: 'STOCK', quantity: 100, totalCost: 3000, currency: 'BRL',
                taxLots: [{ date: new Date('2026-05-10T00:00:00.000Z'), quantity: 100, price: 30 }],
            },
            {
                assetMap: new Map([['PETR4', { price: 32, change: 1, priceDate: '2026-09-01' }]]),
                usdRate: 5, usdChange: 0, macroRates: { cdiRate: 14 },
                isTodayBusinessDay: true, todayKey: '2026-09-01',
            },
        );

        // `dividendsReceived` e `dayDividends` são acrescentados por
        // buildWalletPayload depois do processamento — a máscara vê os dois.
        const publicados = Object.keys({ ...processed, dividendsReceived: 0, dayDividends: 0 });

        expect(publicados.sort()).toEqual([...CAMPOS_DO_ATIVO].sort());
    });
});
