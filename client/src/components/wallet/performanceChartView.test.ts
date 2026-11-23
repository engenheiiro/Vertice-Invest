import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    buildXAxisTicks, chartPalette, filterByRange, formatTooltipLabel, formatTooltipValue, formatXTick, formatYTick,
    isWalletWinning, reconcileWithKpis, seriesKeys, sortPerformanceHistory, tickIntervalFor, toDisplayData,
    type PerformancePoint,
} from './performanceChartView';
import type { WalletKPIs } from '../../contexts/WalletContext';

const pt = (date: string, wallet = 1, cdi = 0, extra: Partial<PerformancePoint> = {}): PerformancePoint =>
    ({ date, wallet, walletRoi: wallet, cdi, ibov: 0, ...extra });

const kpis = (over: Partial<WalletKPIs>) => over as WalletKPIs;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 15, 12));
});
afterEach(() => { vi.useRealTimers(); });

describe('sortPerformanceHistory', () => {
    it('ordena por data de calendário e devolve [] sem lista', () => {
        const sorted = sortPerformanceHistory({ history: [pt('2026-11-01'), pt('2025-01-02'), pt('2026-02-03')] });
        expect(sorted.map((p) => p.date)).toEqual(['2025-01-02', '2026-02-03', '2026-11-01']);
        expect(sortPerformanceHistory(null)).toEqual([]);
        expect(sortPerformanceHistory({ history: 'x' })).toEqual([]);
    });
});

describe('reconcileWithKpis', () => {
    const data = [pt('2026-10-01'), pt('2026-11-01', 5)];

    it('ancora o último ponto nos KPIs; walletRoi só troca quando o KPI é número', () => {
        const out = reconcileWithKpis(data, kpis({ totalEquity: 900, weightedRentability: 7, totalResultPercent: 3 }), false);
        expect(out[1]).toMatchObject({ equity: 900, wallet: 7, walletRoi: 3 });
        expect(out[0]).toBe(data[0]);
        const semPct = reconcileWithKpis(data, kpis({ totalEquity: 900, weightedRentability: 7 }), false);
        expect(semPct[1].walletRoi).toBe(5);
    });

    it('não mexe em demo, sem KPIs ou com patrimônio ≤ 0', () => {
        expect(reconcileWithKpis(data, kpis({ totalEquity: 900 }), true)).toBe(data);
        expect(reconcileWithKpis(data, null, false)).toBe(data);
        expect(reconcileWithKpis(data, kpis({ totalEquity: 0 }), false)).toBe(data);
    });
});

describe('filterByRange', () => {
    const base = [pt('2025-06-01'), pt('2026-01-05'), pt('2026-10-20'), pt('2026-11-10')];

    it('mantém o ponto-âncora anterior ao corte', () => {
        expect(filterByRange(base, '1M').map((p) => p.date)).toEqual(['2026-10-20', '2026-11-10']);
        expect(filterByRange(base, 'YTD').map((p) => p.date)).toEqual(['2025-06-01', '2026-01-05', '2026-10-20', '2026-11-10']);
        expect(filterByRange(base, 'ALL')).toBe(base);
        expect(filterByRange([], '12M')).toEqual([]);
    });

    it('sem ponto no período fica com os dois últimos; tudo no período devolve a série', () => {
        expect(filterByRange(base.slice(0, 3), '1M').map((p) => p.date)).toEqual(['2026-01-05', '2026-10-20']);
        expect(filterByRange(base.slice(3), '1M')).toHaveLength(1);
    });
});

describe('séries e selo', () => {
    it('visão em R$ cria as chaves *BRL com 0 no lugar de ausente', () => {
        const [p] = toDisplayData([pt('2026-11-01', 1, 0, { equity: 10, cdiValue: 9 })], 'brl');
        expect(p).toMatchObject({ walletBRL: 10, cdiBRL: 9, ipcaBRL: 0, ibovBRL: 0 });
        const pct = [pt('2026-11-01')];
        expect(toDisplayData(pct, 'pct')).toBe(pct);
        expect(seriesKeys('brl').walletName).toBe('walletBRL');
        expect(seriesKeys('pct').walletName).toBe('walletVal');
    });

    it('selo exige passar o CDI e, com Ibovespa visível, também o Ibovespa', () => {
        const data = [pt('2026-11-01', 5, 4, { ibov: 6 })];
        expect(isWalletWinning(data, data, 'pct', false)).toBe(true);
        expect(isWalletWinning(data, data, 'pct', true)).toBe(false);
        const brl = toDisplayData([pt('2026-11-01', 0, 0, { equity: 10, cdiValue: 10 })], 'brl');
        expect(isWalletWinning([], brl, 'brl', false)).toBe(false);
    });

    it('ticks: no mês alternados + último; senão um por mês', () => {
        const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((d) => pt(d));
        expect(buildXAxisTicks(days, '1M')).toEqual(['2026-11-01', '2026-11-03', '2026-11-04']);
        expect(buildXAxisTicks([...days, pt('2026-12-01')], 'ALL')).toEqual(['2026-11-01', '2026-12-01']);
        expect(buildXAxisTicks([], 'ALL')).toEqual([]);
        expect(tickIntervalFor('YTD')).toBe(0);
        expect(tickIntervalFor('ALL')).toBe('preserveStartEnd');
    });
});

describe('formatadores e tema', () => {
    it('eixos e tooltip', () => {
        expect(formatXTick('2026-11-10', '1M')).toBe('10 de nov');
        expect(formatXTick('2026-06-01', 'ALL')).toBe('jun/26');
        expect(formatXTick('lixo', 'ALL')).toBe('lixo');
        expect(formatYTick(12000, 'brl', false)).toBe('R$12k');
        expect(formatYTick(12000, 'brl', true)).not.toContain('12');
        expect(formatYTick(3.6, 'pct', true)).toBe('4%');
        expect(formatTooltipValue(1.234, 'cdi', 'pct', false)).toEqual(['1.23%', 'CDI']);
        expect(formatTooltipValue(1, 'outro', 'brl', true)[1]).toBe('outro');
        expect(formatTooltipLabel('2026-11-10')).toBe('10/11/2026');
    });

    it('paleta inverte o Ibovespa entre os temas', () => {
        expect(chartPalette('light').ibovStroke).toBe('#475569');
        expect(chartPalette('dark').ibovStroke).toBe('#cbd5e1');
    });
});
