import { describe, expect, it } from 'vitest';
import type { WalletKPIs } from '../../contexts/WalletContext';
import { buildWalletSummaryView } from './walletSummaryView';

const kpis = (over: Partial<WalletKPIs> = {}): WalletKPIs => ({
    totalEquity: 22149.42, totalInvested: 21856.44, totalResult: 300.84, totalResultPercent: 1.38,
    dayVariation: 7.51, dayVariationPercent: 0.03, totalDividends: 7.87, projectedDividends: 7.25,
    weightedRentability: 2.03, dataQuality: 'AUDITED', ...over,
});

describe('buildWalletSummaryView', () => {
    it('saldo bruto é Aplicado + Resultado (identidade do gráfico), não patrimônio + proventos', () => {
        const view = buildWalletSummaryView(kpis());
        expect(view.totalGross).toBeCloseTo(22157.28, 2);
        expect(view.totalGross).not.toBeCloseTo(22149.42 + 7.87, 2);
        expect(view.grossMultiple).toBeCloseTo(22157.28 / 21856.44, 6);
    });

    it('sem aporte o múltiplo é zero; o resto segue a régua do Terminal', () => {
        const view = buildWalletSummaryView(kpis({ totalInvested: 0, totalResult: -5, totalEquity: 0, dataQuality: 'ESTIMATED' }));
        expect(view.grossMultiple).toBe(0);
        expect(view.capitalVariationPercent).toBe(0);
        expect(view.isTotalPositive).toBe(false);
        expect(view.isAudited).toBe(false);
    });
});
