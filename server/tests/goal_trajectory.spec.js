/**
 * Trajetória da meta (Real / Plano / Projeção) — as duas quebras que abriam
 * buracos visíveis no gráfico:
 *
 *  1. ÂNCORA DA PROJEÇÃO. Todo ponto plotado é o dia 1º do mês, mas o corte era
 *     por distância em meses até `now`. Do dia 16 em diante essa distância passa
 *     de −0,5 e o ponto do mês corrente perdia `projected` — justamente o ponto
 *     onde o Real termina. Com passo trimestral o próximo ponto elegível ficava
 *     3 meses adiante: um vão que aparecia no dia 16 e sumia no dia 1º.
 *
 *  2. FUSO DO RÓTULO. O ponto é um MÊS, não um instante. Serializado como
 *     meia-noite LOCAL do servidor, um processo em UTC virava o mês anterior no
 *     browser em BRT e o eixo inteiro saía um mês adiantado.
 *
 * Fixture ancorada na carteira real que expôs o bug: meta de R$ 50 mil criada em
 * 30/07 com baseline de R$ 374,31 (carteira lançada minutos depois).
 */
import { describe, it, expect } from 'vitest';
import { buildTrajectory } from '../controllers/goalsController.js';

const GOAL = {
    targetAmount: 50000,
    monthlyTarget: 2000,
    expectedAnnualRate: 10,
    startDate: new Date(2026, 6, 30, 16, 50),
    targetDate: undefined,
    mirrorWallet: true,
};

const SNAPSHOTS = [
    { date: new Date(2026, 6, 31), totalEquity: 20700.15 },
    { date: new Date(2026, 7, 15), totalEquity: 21036.70 },
];

const PROJECTION = {
    startValue: 374.31,
    currentValue: 21036.70,
    projectedDate: new Date(2027, 8, 8),
    plannedDate: new Date(2028, 5, 20),
};

const build = (now, overrides = {}) => buildTrajectory(
    { ...GOAL, ...(overrides.goal || {}) },
    overrides.snapshots || SNAPSHOTS,
    [],
    { ...PROJECTION, ...(overrides.projection || {}) },
    now,
);

const lastIndexOf = (points, key) => points.reduce((acc, p, i) => (p[key] !== undefined ? i : acc), -1);
const firstIndexOf = (points, key) => points.findIndex((p) => p[key] !== undefined);

describe('buildTrajectory', () => {
    describe('âncora da projeção', () => {
        it('Real e Projeção compartilham o ponto do mês corrente no dia 16 (regressão do buraco)', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            expect(lastIndexOf(points, 'real')).toBe(firstIndexOf(points, 'projected'));
        });

        it('a emenda não depende do dia do mês', () => {
            // O corte antigo passava até o dia 15 e falhava a partir do 16.
            for (let day = 1; day <= 28; day++) {
                const points = build(new Date(2026, 7, day, 16, 0));
                const lastReal = lastIndexOf(points, 'real');
                expect(lastReal).toBeGreaterThan(-1);
                expect(firstIndexOf(points, 'projected'), `dia ${day}`).toBe(lastReal);
            }
        });

        it('a projeção parte exatamente do patrimônio atual', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const anchor = points[firstIndexOf(points, 'projected')];
            expect(anchor.projected).toBe(PROJECTION.currentValue);
            expect(anchor.real).toBe(PROJECTION.currentValue);
        });

        it('a projeção cresce e não ultrapassa o teto de 2% acima do alvo', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const values = points.filter((p) => p.projected !== undefined).map((p) => p.projected);
            expect(values.length).toBeGreaterThan(1);
            for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
            expect(Math.max(...values)).toBeLessThanOrEqual(GOAL.targetAmount * 1.02);
        });
    });

    describe('chegada no alvo', () => {
        it('a Projeção termina EM CIMA do alvo, não abaixo dele', () => {
            // Regressão: a série parava no dia 1º anterior à chegada (R$ 33,2 mil
            // numa meta de R$ 35 mil) e a linha azul morria longe da linha da Meta.
            const points = build(new Date(2026, 7, 16, 16, 0));
            const last = points[lastIndexOf(points, 'projected')];
            expect(last.projected).toBe(GOAL.targetAmount);
        });

        it('a chegada da Projeção cai na Data prevista do cabeçalho', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const last = new Date(points[lastIndexOf(points, 'projected')].t);
            expect(last.getUTCFullYear()).toBe(PROJECTION.projectedDate.getFullYear());
            expect(last.getUTCMonth()).toBe(PROJECTION.projectedDate.getMonth());
            expect(last.getUTCDate()).toBe(PROJECTION.projectedDate.getDate());
        });

        it('o Plano também termina em cima do alvo, na data planejada', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const idx = lastIndexOf(points, 'planned');
            expect(points[idx].planned).toBe(GOAL.targetAmount);
            expect(new Date(points[idx].t).getUTCMonth()).toBe(PROJECTION.plannedDate.getMonth());
        });

        it('o ponto de chegada não carrega Real (é marcador no futuro)', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const landings = points.filter((p) => new Date(p.t).getUTCDate() !== 1);
            expect(landings.length).toBeGreaterThan(0);
            for (const p of landings) expect(p.real).toBeUndefined();
        });

        it('meta já batida não ganha ponto de chegada abaixo do patrimônio', () => {
            const now = new Date(2026, 7, 16, 16, 0);
            const points = build(now, {
                goal: { targetAmount: 1000 },
                projection: { projectedDate: now, plannedDate: new Date(2026, 7, 8) },
            });
            const projected = points.filter((p) => p.projected !== undefined).map((p) => p.projected);
            for (const v of projected) expect(v).toBeGreaterThanOrEqual(PROJECTION.currentValue);
        });

        it('meta já batida: a âncora não é puxada para baixo do Real pelo teto', () => {
            // Alvo de R$ 1 mil com patrimônio de R$ 21 mil: o clamp em target*1,02
            // colocava a projeção em R$ 1.020 — abaixo da curva Real.
            const now = new Date(2026, 7, 16, 16, 0);
            const points = build(now, {
                goal: { targetAmount: 1000 },
                projection: { projectedDate: now, plannedDate: new Date(2026, 7, 8) },
            });
            const anchor = points[firstIndexOf(points, 'projected')];
            expect(anchor.projected).toBe(PROJECTION.currentValue);
        });
    });

    describe('rótulo do eixo (fuso)', () => {
        it('o dia-calendário de todo ponto é o mesmo em UTC e em BRT', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            expect(points.length).toBeGreaterThan(1);
            for (const p of points) {
                const d = new Date(p.t);
                const brt = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const utc = d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
                expect(brt, p.t).toBe(utc);
            }
        });

        it('os pontos mensais caem no dia 1º; só as chegadas fogem disso', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const offMonth = points.filter((p) => new Date(p.t).getUTCDate() !== 1);
            // Duas chegadas: a do Plano e a da Projeção.
            expect(offMonth.length).toBeLessThanOrEqual(2);
            expect(points.length - offMonth.length).toBeGreaterThan(1);
        });

        it('o primeiro ponto é o mês de início da meta, não o anterior', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const first = new Date(points[0].t);
            expect(first.getUTCFullYear()).toBe(2026);
            expect(first.getUTCMonth()).toBe(6); // julho — startDate é 30/07
        });

        it('os meses são estritamente crescentes e sem repetição', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const ts = points.map((p) => new Date(p.t).getTime());
            for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
        });
    });

    describe('série Real', () => {
        it('não tem buraco interno entre o primeiro e o último ponto', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const idx = points.map((p, i) => (p.real !== undefined ? i : -1)).filter((i) => i >= 0);
            expect(idx.length).toBeGreaterThan(1);
            expect(idx.at(-1) - idx[0]).toBe(idx.length - 1);
        });

        it('termina no mês corrente com o patrimônio atual', () => {
            const now = new Date(2026, 7, 16, 16, 0);
            const points = build(now);
            const last = points[lastIndexOf(points, 'real')];
            expect(new Date(last.t).getUTCMonth()).toBe(now.getMonth());
            expect(last.real).toBe(PROJECTION.currentValue);
        });
    });

    describe('série Plano', () => {
        it('parte do baseline salvo e não passa do alvo', () => {
            const points = build(new Date(2026, 7, 16, 16, 0));
            const planned = points.filter((p) => p.planned !== undefined).map((p) => p.planned);
            expect(planned[0]).toBeCloseTo(PROJECTION.startValue, 1);
            expect(Math.max(...planned)).toBeLessThanOrEqual(GOAL.targetAmount);
        });
    });
});
