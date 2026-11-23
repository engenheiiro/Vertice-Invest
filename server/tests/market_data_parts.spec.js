// Testes curtos das partes extraídas de marketDataService (services/marketData/).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../models/MarketAsset.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { find: vi.fn(), findOne: vi.fn() } }));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: { getFullHistory: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const { sessionDateKey } = await import('../services/marketData/sessionDate.js');
const { needsNameHeal, fillPrimaryQuotes, fillHistoryFallbacks } = await import('../services/marketData/priceLookup.js');
const { selectExDateCandidates } = await import('../services/marketData/exDateDividends.js');
const { pastQuarantine, retirementOps, daysSince } = await import('../services/marketData/assetRetirement.js');

const NOW = new Date('2026-11-18T15:00:00-03:00');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('sessionDate', () => {
  it('data da sessão no calendário de Brasília; ausente ou inválida vira null', () => {
    expect(sessionDateKey(new Date('2026-11-18T01:00:00Z'))).toBe('2026-11-17');
    expect(sessionDateKey(null)).toBeNull();
    expect(sessionDateKey('lixo')).toBeNull();
  });
});

describe('priceLookup', () => {
  it('nome vazio ou igual ao ticker pede self-heal só nas classes com nome no Yahoo', () => {
    expect(needsNameHeal({ type: 'STOCK', name: 'petr4' }, 'PETR4')).toBe(true);
    expect(needsNameHeal({ type: 'STOCK', name: 'Petrobras' }, 'PETR4')).toBe(false);
    expect(needsNameHeal({ type: 'CRYPTO', name: '' }, 'BTC')).toBe(false);
    expect(needsNameHeal(null, 'X')).toBe(false);
  });

  it('lote: preço do cache, fallback na série e preço 0 para quem não tem nada', () => {
    const map = new Map();
    const pairs = [{ original: 'petr4', clean: 'PETR4' }, { original: 'BTC', clean: 'BTC' }, { original: 'X', clean: 'X' }];
    const byTicker = new Map([
      ['PETR4', { lastPrice: 40, allocationClass: 'STOCK' }],
      ['BTC', { type: 'CRYPTO', lastPrice: 0 }],
    ]);
    const { primaryHits, missingKeys } = fillPrimaryQuotes(map, pairs, byTicker);
    expect(primaryHits).toBe(1);
    expect([...missingKeys]).toEqual(['BTC-USD', 'X']);
    expect(Object.keys(map.get('petr4'))).toEqual(['price', 'change', 'priceDate', 'previousClose', 'name', 'sector', 'allocationClass', 'dy']);

    const hist = new Map([['BTC-USD', { history: [{ date: '2026-11-01', close: 1 }, { date: '2026-11-17', close: 2 }] }]]);
    expect(fillHistoryFallbacks(map, pairs, byTicker, hist)).toEqual({ fallbackHits: 1, misses: 1 });
    expect(map.get('BTC')).toEqual({ price: 2, change: 0, name: 'BTC', sector: 'Outros', isFallback: true });
    expect(map.get('X')).toEqual({ price: 0, change: 0, name: 'X', sector: 'Outros' });
  });
});

describe('exDateDividends', () => {
  it('só cotação de hoje, com fechamento ajustado e fora de ETF de acumulação', () => {
    const assetMap = new Map([['PETR4', { type: 'STOCK' }], ['BOVA11', { type: 'ETF' }]]);
    const quotes = [
      { ticker: 'petr4', previousClose: 10, marketTime: NOW, volume: 5 },
      { ticker: 'PETR4', previousClose: 10, marketTime: new Date('2026-11-17T15:00:00Z') },
      { ticker: 'BOVA11', previousClose: 100, marketTime: NOW },
      { ticker: 'PETR4', previousClose: 0, marketTime: NOW },
    ];
    const out = selectExDateCandidates((t) => t.toUpperCase(), quotes, assetMap, '2026-11-18');
    expect(out).toEqual([{ ticker: 'PETR4', type: 'STOCK', adjusted: 10, volume: 5 }]);
  });
});

describe('assetRetirement', () => {
  it('quarentena conta da última prova de pregão; idade ausente não aposenta', () => {
    const idades = new Map([['A', { days: 90 }], ['B', { days: 89 }], ['C', { days: null }]]);
    expect(pastQuarantine([{ ticker: 'A' }, { ticker: 'B' }, { ticker: 'C' }, { ticker: 'D' }], idades))
      .toEqual([{ ticker: 'A' }]);
    expect(daysSince(new Date(NOW.getTime() - 3 * 86400000))).toBe(3);
    expect(daysSince(null)).toBeNull();
  });

  it('a escrita de baixa é terminal e completa: blacklist e inativo juntos', () => {
    const [op] = retirementOps([{ ticker: 'A' }], new Map([['A', { days: 120, basis: 'candle' }]]), NOW);
    expect(op.updateOne.filter).toEqual({ ticker: 'A', isBlacklisted: false });
    expect(op.updateOne.update.$set).toEqual({
      isBlacklisted: true, isActive: false, retiredAt: NOW,
      retiredReason: 'auto: 120d sem pregão (candle) e sem cotação em nenhuma fonte',
    });
  });
});
