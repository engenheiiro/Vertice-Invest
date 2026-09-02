import { describe, expect, it } from 'vitest';
import {
  boundedPointLimit,
  boundedPageLimit,
  downsampleTimeSeries,
} from '../utils/timeSeriesDownsample.js';

const series = (length) => Array.from({ length }, (_, index) => ({ index, date: `D${index}` }));

describe('Fase 3 — payload limitado de séries temporais', () => {
  it('limita 3.650 snapshots a no máximo 480 sem perder início, fim ou 120 dias recentes', () => {
    const input = series(3650);
    const output = downsampleTimeSeries(input, { maxPoints: 480, recentPoints: 120 });

    expect(output.length).toBeLessThanOrEqual(480);
    expect(output[0]).toBe(input[0]);
    expect(output.at(-1)).toBe(input.at(-1));
    expect(output.slice(-120)).toEqual(input.slice(-120));
    expect(output.every((item, index) => index === 0 || output[index - 1].index < item.index)).toBe(true);
  });

  it('preserva o fechamento de cada mês antigo para não alterar retornos mensais', () => {
    const input = Array.from({ length: 730 }, (_, index) => ({
      index,
      date: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
    }));
    const output = downsampleTimeSeries(input, { maxPoints: 180, recentPoints: 120 });
    const oldInput = input.slice(0, -120);
    const oldOutput = output.slice(0, -120);
    const expectedMonthEnds = [...new Map(oldInput.map((point) => [point.date.slice(0, 7), point])).values()];

    for (const monthEnd of expectedMonthEnds) expect(oldOutput).toContain(monthEnd);
  });

  it('respeita o dia civil do Brasil quando o fechamento cruza o mês em UTC', () => {
    const input = Array.from({ length: 150 }, (_, index) => {
      const civilDate = new Date(Date.UTC(2026, 6, 1 + index));
      const dayKey = civilDate.toISOString().slice(0, 10);
      const utcClosingDate = new Date(`${dayKey}T23:59:00-03:00`).toISOString();
      return { index, dayKey, date: utcClosingDate };
    });
    const augustClosing = input.find((point) => point.dayKey === '2026-08-31');
    const output = downsampleTimeSeries(input, { maxPoints: 60, recentPoints: 30 });

    expect(augustClosing.date.startsWith('2026-09-01')).toBe(true);
    expect(output.slice(0, -30)).toContain(augustClosing);
  });

  it('não altera séries que já cabem no orçamento', () => {
    const input = series(90);
    expect(downsampleTimeSeries(input, { maxPoints: 480 })).toBe(input);
  });

  it('limita parâmetros externos entre 60 e 1.000 pontos', () => {
    expect(boundedPointLimit('1')).toBe(60);
    expect(boundedPointLimit('500')).toBe(500);
    expect(boundedPointLimit('999999')).toBe(1000);
    expect(boundedPointLimit('inválido', 480)).toBe(480);
  });

  it('paginação aceita páginas pequenas e mantém teto de 1.000', () => {
    expect(boundedPageLimit('1')).toBe(1);
    expect(boundedPageLimit('20')).toBe(20);
    expect(boundedPageLimit('999999')).toBe(1000);
  });
});
