import { describe, it, expect } from 'vitest';
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
        },
        {
            ticker: 'MXRF11', type: 'FII', quantity: 10_000, averagePrice: 10, currentPrice: 10,
            totalValue: 100_000, totalCost: 100_000, profit: 0, profitPercent: 0,
            dayChangePct: 0, dividendsReceived: 4_000, accruedValue: null,
        },
    ],
    kpis: {
        totalEquity: EQUITY, totalInvested: 220_000, totalResult: 30_000,
        totalResultPercent: 13.64, dayVariation: 900, dayVariationPercent: 0.36,
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
        const real = [250_000, 220_000, 150_000, 120_000, 30_000, 12_000, 8_000, 4_000, 1_000, 900];
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

    it('carteira sem patrimônio não divide por zero', () => {
        const s = buildPublicScale({ showValues: false, totalEquity: 0 });
        expect(s.factor).toBe(0);
        expect(maskKpis(s, { totalEquity: 0, totalInvested: 0 }).totalEquity).toBe(0);
    });
});
