import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Partes do motor de sinais (server/services/engines/signals/): divergência,
// varredura por ativo e auditoria. Sem banco: modelos e logger mockados.

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/QuantSignal.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));

const { resolveDivergenceOpts, findPivotLows, evaluateDivergence } = await import('../services/engines/signals/divergence.js');
const { buildHistoryMap, newScanState, scanAsset } = await import('../services/engines/signals/scanner.js');
const { auditSignals } = await import('../services/engines/signals/backtest.js');

const NOW = new Date('2026-11-18T15:00:00Z');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('divergence', () => {
  it('opções ausentes caem nos padrões; null em wing também', () => {
    expect(resolveDivergenceOpts({ wing: null, rsiZone: 30 })).toEqual({
      wing: 2, minSeparation: 3, maxLookback: 40, rsiZone: 30, maxRecentAge: 6,
    });
  });

  it('pivô de baixa exige fechar abaixo dos vizinhos e ter RSI', () => {
    const closes = [5, 4, 3, 4, 5, 4, 2, 4, 5];
    const rsi = closes.map((_, i) => (i === 6 ? null : 40));
    expect(findPivotLows(closes, rsi, 2, 40)).toEqual([2]);
    expect(findPivotLows(closes, closes.map(() => 40), 2, 40)).toEqual([2, 6]);
  });

  it('preço mais baixo com RSI mais alto vira divergência; sem par, null', () => {
    const closes = [3, 2.5, 2, 2.5, 3, 4, 3, 4];
    const rsi = [40, 35, 30, 33, 36, 30, 20, 25];
    const o = resolveDivergenceOpts({});
    expect(evaluateDivergence(closes, rsi, [2, 6], o)).toEqual({
      rsiAtLow: 30, priorRsiLow: 20, priceLow: 2, priorPriceLow: 3, barsBetween: 4,
    });
    expect(evaluateDivergence(closes, rsi, [2, 4], o)).toBeNull();
    expect(evaluateDivergence(closes, rsi, [2], o)).toBeNull();
  });
});

describe('scanner', () => {
  it('mapa de histórico só leva séries com mais de 15 pregões, do recente ao antigo', () => {
    const day = (d) => ({ date: new Date(`2026-11-${String(d).padStart(2, '0')}T12:00:00Z`), close: d });
    const map = buildHistoryMap([
      { ticker: 'A', history: Array.from({ length: 16 }, (_, i) => day(i + 1)) },
      { ticker: 'B', history: Array.from({ length: 15 }, (_, i) => day(i + 1)) },
      { ticker: 'C' },
    ]);
    expect([...map.keys()]).toEqual(['A']);
    expect(map.get('A')[0].close).toBe(16);
  });

  it('exceção no meio da análise tira o ticker dos analisados e mantém o que já foi gravado', () => {
    const engine = {
      determineRiskProfile: () => 'DEFENSIVE',
      _volumeStats: () => ({ confirmed: true, ratio: 2 }),
      calculateRSI: () => null,
      detectBullishDivergence: () => null,
      _grahamUrgency: () => 'CRITICAL',
    };
    const scan = newScanState();
    const asset = { ticker: 'X', type: 'STOCK', lastPrice: 10, pl: 4, p_vp: 0.5, roe: '7' };
    scanAsset(engine, asset, new Map([['X', [{ close: 10 }]]]), {}, scan);
    expect(scan.scannedTickers.has('X')).toBe(false);
    expect(scan.upsertOps).toEqual([]);

    scanAsset(engine, { ...asset, roe: 7 }, new Map([['X', [{ close: 10 }]]]), {}, scan);
    expect(scan.scannedTickers.has('X')).toBe(true);
    expect(scan.upsertOps[0].updateOne.filter).toEqual({ ticker: 'X', type: 'DEEP_VALUE', status: 'ACTIVE' });
    expect(scan.upsertOps[0].updateOne.update.$setOnInsert.timestamp).toEqual(NOW);
  });
});

describe('backtest', () => {
  it('encerra no alvo, no stop e no horizonte; ignora sem preço', () => {
    const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000);
    const signals = [
      { _id: 1, ticker: 'A', priceAtSignal: 100, timestamp: daysAgo(1) },
      { _id: 2, ticker: 'B', priceAtSignal: 100, timestamp: daysAgo(1) },
      { _id: 3, ticker: 'C', priceAtSignal: 100, timestamp: daysAgo(14) },
      { _id: 4, ticker: 'C', priceAtSignal: 100, timestamp: daysAgo(13) },
      { _id: 5, ticker: 'D', priceAtSignal: 100, timestamp: daysAgo(30) },
    ];
    const prices = new Map([['A', 104], ['B', 96], ['C', 101], ['D', 0]]);
    const { updates, tally } = auditSignals(signals, prices, 14);
    expect(updates.map((u) => [u.updateOne.filter._id, u.updateOne.update.$set.status])).toEqual([
      [1, 'HIT'], [2, 'MISS'], [3, 'NEUTRAL'],
    ]);
    expect(tally).toEqual({ processed: 3, hits: 1, misses: 1, expired: 1 });
  });
});
