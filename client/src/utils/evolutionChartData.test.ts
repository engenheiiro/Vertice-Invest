import { describe, it, expect } from 'vitest';
import { buildEvolutionChartData, summarizeEvolutionWindow, type ChartGranularity, type ChartWindow, type EvolutionChartPoint } from './evolutionChartData';
import type { HistoryPoint } from '../contexts/WalletContext';

// Data com hora ao MEIO-DIA local: 12h de folga de cada lado da meia-noite torna
// o localDayKey estável independentemente do fuso do runner de testes.
const snap = (y: number, m: number, d: number, equity: number, invested: number): HistoryPoint => ({
    date: new Date(y, m, d, 12, 0, 0).toISOString(),
    totalEquity: equity,
    totalInvested: invested,
    profit: equity - invested,
});

const kpis = (totalEquity: number, totalInvested: number, totalResult?: number) => ({
    totalEquity,
    totalInvested,
    totalResult: totalResult ?? totalEquity - totalInvested,
});

// 1 de julho de 2026 (quarta-feira), meio-dia.
const NOW = new Date(2026, 6, 1, 12, 0, 0);

const build = (
    history: HistoryPoint[],
    k: ReturnType<typeof kpis>,
    granularity: ChartGranularity,
    window: ChartWindow
) => buildEvolutionChartData({ history, kpis: k, granularity, window, now: NOW });

const byLabel = (pts: ReturnType<typeof build>, label: string) => pts.find((p) => p.label === label);

describe('buildEvolutionChartData — MENSAL', () => {
    it('usa o valor de FIM de mês (último snapshot do mês vence) e mês atual é LIVE', () => {
        const history = [
            snap(2026, 4, 31, 1000, 1000), // maio
            snap(2026, 5, 10, 1050, 1050), // junho (meio)
            snap(2026, 5, 30, 1100, 1050), // junho (fim) — deve vencer
        ];
        const pts = build(history, kpis(1200, 1100, 100), 'MONTHLY', 'ALL');

        expect(pts.map((p) => p.label)).toEqual(['05/26', '06/26', '07/26']);

        const june = byLabel(pts, '06/26')!;
        expect(june.realEquity).toBe(1100); // fim de mês, não o do dia 10
        expect(june.isLive).toBeUndefined();

        const live = byLabel(pts, '07/26')!;
        expect(live.isLive).toBe(true);
        expect(live.realEquity).toBe(1200);
        expect(live.realProfit).toBe(100); // vem de kpis.totalResult
    });

    it('janela 6M/12M corta o número de barras pelo fim', () => {
        // 10 meses de snapshots (set/2025 → jun/2026) + LIVE de julho.
        const history: HistoryPoint[] = [];
        for (let i = 0; i < 10; i++) {
            const month = 8 + i; // começa em setembro (índice 8) de 2025
            history.push(snap(2025, month, 28, 1000 + i, 1000));
        }
        const all = build(history, kpis(2000, 1000), 'MONTHLY', 'ALL');
        const m12 = build(history, kpis(2000, 1000), 'MONTHLY', '12M');
        const m6 = build(history, kpis(2000, 1000), 'MONTHLY', '6M');

        expect(all.length).toBe(11); // 10 meses + live
        expect(m12.length).toBe(11); // menos que 12, mantém tudo
        expect(m6.length).toBe(6);
        expect(m6[m6.length - 1].isLive).toBe(true);
    });

    it('sem histórico mas com patrimônio vivo → só o ponto LIVE', () => {
        const pts = build([], kpis(500, 400), 'MONTHLY', 'ALL');
        expect(pts.length).toBe(1);
        expect(pts[0].isLive).toBe(true);
    });

    it('carteira vazia → array vazio', () => {
        expect(build([], kpis(0, 0), 'MONTHLY', 'ALL')).toEqual([]);
    });
});

describe('buildEvolutionChartData — DIÁRIO (forward-fill)', () => {
    it('preenche fim de semana repetindo o último valor (eixo contínuo)', () => {
        // Sexta 26/06 = 1000. Sáb 27 e Dom 28 não têm snapshot.
        const history = [snap(2026, 5, 26, 1000, 1000)];
        const pts = build(history, kpis(1010, 1000, 10), 'DAILY', '30D');

        expect(byLabel(pts, '27/06')!.realEquity).toBe(1000); // sábado preenchido
        expect(byLabel(pts, '28/06')!.realEquity).toBe(1000); // domingo preenchido
        expect(byLabel(pts, '27/06')!.isLive).toBeUndefined();

        // Sequência contínua até o LIVE, sem buracos.
        expect(pts.map((p) => p.label)).toEqual(['26/06', '27/06', '28/06', '29/06', '30/06', '01/07']);
        expect(pts[pts.length - 1].isLive).toBe(true);
    });

    it('respeita a janela (7D) e semeia forward-fill a partir de snapshot anterior', () => {
        const history = [
            snap(2026, 5, 20, 900, 900),   // fora da janela de 7D → vira semente
            snap(2026, 5, 30, 1000, 1000), // dentro da janela
        ];
        const pts = build(history, kpis(1000, 1000), 'DAILY', '7D');

        // 7D a partir de 01/07 → começa em 25/06.
        expect(pts[0].label).toBe('25/06');
        expect(pts[0].realEquity).toBe(900); // semeado do snapshot de 20/06
        expect(byLabel(pts, '30/06')!.realEquity).toBe(1000);
        expect(pts.length).toBe(7); // 25→30 (6 dias) + live
    });

    it('o ponto de hoje é LIVE (kpis), ignorando snapshot do próprio dia', () => {
        const history = [
            snap(2026, 5, 30, 1000, 1000),
            snap(2026, 6, 1, 9999, 9999), // snapshot de HOJE deve ser descartado
        ];
        const pts = build(history, kpis(1200, 1100, 100), 'DAILY', '30D');

        const julys = pts.filter((p) => p.label === '01/07');
        expect(julys.length).toBe(1);
        expect(julys[0].isLive).toBe(true);
        expect(julys[0].realEquity).toBe(1200); // de kpis, não 9999
    });

    it('periodVariation = ΔEquity − ΔInvested (aporte não conta como variação)', () => {
        const history = [
            snap(2026, 5, 29, 1000, 1000),
            snap(2026, 5, 30, 1010, 1000), // +10 de mercado, sem aporte
        ];
        const pts = build(history, kpis(1010, 1000, 10), 'DAILY', '30D');
        expect(byLabel(pts, '30/06')!.periodVariation).toBeCloseTo(10);
        expect(byLabel(pts, '30/06')!.periodVariationPercent).toBeCloseTo(1); // 10/1000

        const withAporte = [
            snap(2026, 5, 29, 1000, 1000),
            snap(2026, 5, 30, 1050, 1050), // +50 patrimônio mas +50 aporte → variação 0
        ];
        const pts2 = build(withAporte, kpis(1050, 1050), 'DAILY', '30D');
        expect(byLabel(pts2, '30/06')!.periodVariation).toBeCloseTo(0);
    });

    it('prejuízo: baseBar=equity, profitBar=0 e lossBar=invested−equity (capa vermelha)', () => {
        const history = [snap(2026, 5, 30, 900, 1000)];
        const pts = build(history, kpis(900, 1000, -100), 'DAILY', '30D');
        const p = byLabel(pts, '30/06')!;
        expect(p.baseBar).toBe(900);
        expect(p.profitBar).toBe(0);
        expect(p.lossBar).toBe(100);
        expect(p.realProfit).toBe(-100);
    });

    it('lucro: lossBar=0', () => {
        const history = [snap(2026, 5, 30, 1100, 1000)];
        const pts = build(history, kpis(1100, 1000, 100), 'DAILY', '30D');
        const p = byLabel(pts, '30/06')!;
        expect(p.lossBar).toBe(0);
        expect(p.profitBar).toBe(100);
    });

    it('sem histórico mas com patrimônio vivo → só o ponto LIVE', () => {
        const pts = build([], kpis(500, 400), 'DAILY', '30D');
        expect(pts.length).toBe(1);
        expect(pts[0].isLive).toBe(true);
    });
});

describe('summarizeEvolutionWindow', () => {
    // Só realEquity/realInvested importam para o resumo.
    const pt = (realEquity: number, realInvested: number): EvolutionChartPoint =>
        ({ realEquity, realInvested } as EvolutionChartPoint);

    it('lucro puro: +100 e +10% sobre o patrimônio inicial', () => {
        const r = summarizeEvolutionWindow([pt(1000, 1000), pt(1100, 1000)]);
        expect(r.variationValue).toBeCloseTo(100);
        expect(r.variationPercent).toBeCloseTo(10);
    });

    it('desconta aportes da variação do período', () => {
        // +200 de patrimônio mas +150 vieram de aporte → variação de mercado = 50.
        const r = summarizeEvolutionWindow([pt(1000, 1000), pt(1200, 1150)]);
        expect(r.variationValue).toBeCloseTo(50);
        expect(r.variationPercent).toBeCloseTo(5);
    });

    it('prejuízo: −100 e −10%', () => {
        const r = summarizeEvolutionWindow([pt(1000, 1000), pt(900, 1000)]);
        expect(r.variationValue).toBeCloseTo(-100);
        expect(r.variationPercent).toBeCloseTo(-10);
    });

    it('um único ponto → sem variação e sem percentual', () => {
        expect(summarizeEvolutionWindow([pt(1000, 1000)])).toEqual({
            variationValue: 0,
            variationPercent: null,
        });
    });

    it('patrimônio inicial 0 → percentual nulo (sem divisão por zero)', () => {
        const r = summarizeEvolutionWindow([pt(0, 0), pt(100, 100)]);
        expect(r.variationValue).toBeCloseTo(0);
        expect(r.variationPercent).toBeNull();
    });
});
