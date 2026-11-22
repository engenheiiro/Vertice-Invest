import { describe, it, expect } from 'vitest';
import {
  snapshotSummary, timeSeriesSummary, visibleBenchmarks, formatReturnTooltip, formatPointLabel, buildMacroCards,
} from './adminPainelView';

describe('snapshotSummary', () => {
  it('sem estatísticas: reticências, sem alarme', () => {
    expect(snapshotSummary(null)).toEqual({ alert: false, note: '...', created: 0 });
  });

  it('carteira vazia e dia já fotografado não acendem o alarme', () => {
    expect(snapshotSummary({ snapshotStats: { created: 9, empty: 1, exists: 2 } }))
      .toEqual({ alert: false, note: 'Sem anomalias · 1 carteira sem ativos · 2 já do dia', created: 9 });
    expect(snapshotSummary({ snapshotStats: { empty: 3 } }).note).toBe('Sem anomalias · 3 carteiras sem ativos');
    expect(snapshotSummary({}).note).toBe('Sem anomalias');
  });

  it('só `errors` acende o alarme, com singular e plural', () => {
    expect(snapshotSummary({ snapshotStats: { errors: 1, empty: 4 } })).toMatchObject({ alert: true, note: '1 anomalia — snapshot abortado' });
    expect(snapshotSummary({ snapshotStats: { errors: 2 } }).note).toBe('2 anomalias — snapshot abortado');
  });
});

describe('timeSeriesSummary', () => {
  it('acima de 48h é defasado; até 48h é saudável', () => {
    expect(timeSeriesSummary({ timeSeriesAgeHours: 48.1 })).toMatchObject({ stale: true, status: 'ALERTA: Defasado', age: '48.1' });
    expect(timeSeriesSummary({ timeSeriesAgeHours: 48 })).toMatchObject({ stale: false, status: 'Saudável' });
  });

  it('idade ausente ou zero aparece como 0; sem estatísticas, reticências', () => {
    expect(timeSeriesSummary({ timeSeriesAgeHours: null }).age).toBe(0);
    expect(timeSeriesSummary({ timeSeriesAgeHours: 0 }).age).toBe(0);
    expect(timeSeriesSummary(null)).toMatchObject({ stale: false, status: '...', cohort: null });
  });

  it('coorte: tamanho e o que ficou de fora', () => {
    expect(timeSeriesSummary({ timeSeriesTracked: 900, timeSeriesOrphans: 12 }).cohort).toEqual({ tracked: 900, orphans: ' · 12 fora da coorte' });
    expect(timeSeriesSummary({ timeSeriesTracked: 900 }).cohort).toEqual({ tracked: 900, orphans: '' });
  });
});

describe('visibleBenchmarks', () => {
  it('só entra a série que tem algum ponto diferente de zero, na ordem fixa', () => {
    const data = [
      { ibovReturn: 0, cdiReturn: 0.4, ifixReturn: 0, spxReturn: 0, btcReturn: 0 },
      { ibovReturn: 0, cdiReturn: 0.8, ifixReturn: 0, spxReturn: 0, btcReturn: 2 },
    ];
    expect(visibleBenchmarks(data).map((b) => b.name)).toEqual(['CDI', 'BTC']);
    expect(visibleBenchmarks([])).toEqual([]);
  });
});

describe('rótulos do tooltip do backtest', () => {
  it('retorno com sinal e duas casas', () => {
    expect(formatReturnTooltip(1.234, 'IBOV')).toEqual(['+1.23%', 'IBOV']);
    expect(formatReturnTooltip(-0.5, 'CDI')).toEqual(['-0.50%', 'CDI']);
  });

  it('data, número de ativos e último rebalanceamento quando houver', () => {
    expect(formatPointLabel('01/11', { holdingsCount: 8, lastRebalanceDate: '2026-10-20T12:00:00Z' })).toBe('📅 01/11 · 8 ativos · rebal. 20/10/2026');
    expect(formatPointLabel('01/11', undefined)).toBe('📅 01/11');
  });
});

describe('buildMacroCards', () => {
  it('sem Selic ou sem Ibov o macro não é utilizável', () => {
    expect(buildMacroCards(null)).toBeNull();
    expect(buildMacroCards({ selic: { value: 15 } })).toBeNull();
  });

  it('cotação ausente ou zero vira "—", nunca R$ 0', () => {
    const cards = buildMacroCards({
      selic: { value: 15 }, cdi: { value: 14.9 }, ipca: { value: 4.5 },
      ibov: { value: 0 }, usd: { value: 5.4321, change: 0.2 }, btc: { value: Number.NaN },
    });
    const byLabel = Object.fromEntries((cards ?? []).map((c) => [c.label, c]));
    expect(byLabel.Selic.value).toBe('15%');
    expect(byLabel.CDI.value).toBe('14.90%');
    expect(byLabel.Ibovespa.value).toBe('—');
    expect(byLabel['Dólar']).toMatchObject({ value: 'R$ 5.432', change: 0.2 });
    expect(byLabel['S&P 500'].value).toBe('—');
    expect(byLabel.Bitcoin.value).toBe('—');
  });
});
