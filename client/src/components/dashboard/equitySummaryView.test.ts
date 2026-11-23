import { describe, expect, it } from 'vitest';
import type { WalletKPIs } from '../../contexts/WalletContext';
import { buildEquitySummaryView, fixedOrMask, plusSign } from './equitySummaryView';

const kpis = (over: Partial<WalletKPIs> = {}): WalletKPIs => ({
    totalEquity: 1100,
    totalInvested: 1000,
    totalResult: 150,
    totalResultPercent: 15,
    dayVariation: 10,
    dayVariationPercent: 0.9,
    totalDividends: 50,
    projectedDividends: 4,
    weightedRentability: 12,
    dataQuality: 'AUDITED',
    sharpeRatio: null,
    ...over,
});

describe('plusSign', () => {
    it('zero e positivo ganham "+"; negativo não', () => {
        expect(plusSign(true)).toBe('+');
        expect(plusSign(false)).toBe('');
    });
});

describe('fixedOrMask', () => {
    it('formata com 2 casas e trata ausente/NaN como zero', () => {
        expect(fixedOrMask(1.234, false)).toBe('1.23');
        expect(fixedOrMask(null, false)).toBe('0.00');
        expect(fixedOrMask(undefined, false)).toBe('0.00');
        expect(fixedOrMask(Number.NaN, false)).toBe('0.00');
    });

    it('mascara no modo privacidade', () => {
        expect(fixedOrMask(1.234, true)).toBe('•••');
    });
});

describe('buildEquitySummaryView', () => {
    it('variação do capital é patrimônio vs. aplicado, sem proventos', () => {
        const view = buildEquitySummaryView(kpis());
        expect(view.capitalVariationPercent).toBeCloseTo(10);
        expect(view.isCapitalPositive).toBe(true);
        expect(view.capitalClass).toBe('text-[#8ff0c8]');
    });

    it('sem aporte a variação do capital e o múltiplo são zero (sem divisão por zero)', () => {
        const view = buildEquitySummaryView(kpis({ totalInvested: 0, totalEquity: 500 }));
        expect(view.capitalVariationPercent).toBe(0);
        expect(view.grossMultiple).toBe(0);
        expect(view.totalGross).toBe(550);
    });

    it('múltiplo bruto = (patrimônio + proventos) / aplicado', () => {
        const view = buildEquitySummaryView(kpis());
        expect(view.totalGross).toBe(1150);
        expect(view.grossMultiple).toBeCloseTo(1.15);
    });

    it('resultado negativo vira vermelho; rentabilidade negativa vira cinza', () => {
        const view = buildEquitySummaryView(kpis({ totalResult: -1, weightedRentability: -1, totalEquity: 900 }));
        expect(view.isTotalPositive).toBe(false);
        expect(view.totalValueClass).toBe('text-red-400');
        expect(view.totalIconClass).toBe('bg-red-500/10 text-red-400');
        expect(view.rentabilityClass).toBe('text-slate-400');
        expect(view.capitalClass).toBe('text-[#fca5a5]');
    });

    it('dia zerado é plano e conta como positivo', () => {
        const view = buildEquitySummaryView(kpis({ dayVariation: 0 }));
        expect(view.isDayFlat).toBe(true);
        expect(view.isDayPositive).toBe(true);
    });

    it('dia negativo não é plano nem positivo', () => {
        const view = buildEquitySummaryView(kpis({ dayVariation: -3 }));
        expect(view.isDayFlat).toBe(false);
        expect(view.isDayPositive).toBe(false);
    });

    it('só AUDITED ganha o selo verde; ausente cai em estimado', () => {
        expect(buildEquitySummaryView(kpis()).qualityTagClass).toContain('emerald');
        const estimado = buildEquitySummaryView(kpis({ dataQuality: undefined }));
        expect(estimado.isAudited).toBe(false);
        expect(estimado.qualityTagClass).toContain('yellow');
    });

    it('Sharpe nulo some; medido vem com rótulo e explicação', () => {
        expect(buildEquitySummaryView(kpis()).sharpeLabel).toBeNull();
        const view = buildEquitySummaryView(kpis({ sharpeRatio: 1.5, sharpeConfidence: 'LOW', sharpeSample: 30 }));
        expect(view.sharpeLabel).toBe('~1,50');
        expect(view.sharpeTitle).toContain('30 pregões');
    });

    it('campos ausentes contam como zero', () => {
        const vazio = { dataQuality: undefined } as unknown as WalletKPIs;
        const view = buildEquitySummaryView(vazio);
        expect(view.capitalVariationPercent).toBe(0);
        expect(view.totalGross).toBe(0);
        expect(view.isTotalPositive).toBe(true);
        expect(view.isRentabilityPositive).toBe(true);
    });
});
