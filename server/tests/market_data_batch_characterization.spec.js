/**
 * Caracterização de refreshQuotesBatch e getMarketData: trava o payload gravado
 * (campos E ordem das chaves), a ordem das operações do bulkWrite, os logs de
 * anomalia e a forma do item que vai ao scoringEngine. Rede para refatorar sem
 * mudar comportamento. Sem rede e sem banco: tudo mockado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MarketAsset from '../models/MarketAsset.js';
import FundamentalSnapshot from '../models/FundamentalSnapshot.js';
import logger from '../config/logger.js';
import { externalMarketService } from '../services/externalMarketService.js';
import { marketDataService } from '../services/marketDataService.js';
import { _resetSourceStats } from '../utils/sourceHealth.js';

vi.mock('../models/MarketAsset.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), bulkWrite: vi.fn() },
}));
vi.mock('../models/AssetHistory.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), create: vi.fn(), aggregate: vi.fn().mockResolvedValue([]) } }));
vi.mock('../models/UserAsset.js', () => ({ default: { distinct: vi.fn().mockResolvedValue([]) } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/FundamentalSnapshot.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getQuotes: vi.fn(), getFullHistory: vi.fn() },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Quarta, 18/11/2026, 15h BRT: pregão em curso.
const NOW = new Date('2026-11-18T15:00:00-03:00');
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);
const mockFind = (docs) => MarketAsset.find.mockReturnValue({ select: vi.fn().mockResolvedValue(docs) });
const ops = () => MarketAsset.bulkWrite.mock.calls[0]?.[0] || [];
const setOf = (ticker) => ops().find((o) => o.updateOne.filter.ticker === ticker)?.updateOne.update.$set;
const stale = (extra) => ({ updatedAt: minutesAgo(60), lastPrice: 10, isActive: true, failCount: 0, ...extra });
const warnedWith = (key) => logger.warn.mock.calls.find((c) => c[1] && key in c[1]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  _resetSourceStats();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('refreshQuotesBatch — caracterização do payload', () => {
  it('cripto: marketCap e liquidez em volume bruto; nome vazio ganha o nome da fonte', async () => {
    mockFind([stale({ ticker: 'BTC', type: 'CRYPTO', name: '' })]);
    externalMarketService.getQuotes.mockResolvedValue([{
      ticker: 'BTC', price: 90000, change: 2, previousClose: 88235.29, marketTime: new Date(NOW.getTime() - 60000),
      volume: 1000, marketCap: 1.8e12, name: 'Bitcoin USD', source: 'YAHOO',
    }]);
    await marketDataService.refreshQuotesBatch(['btc'], false);
    const set = setOf('BTC');
    expect(Object.keys(set)).toEqual([
      'lastPrice', 'change', 'priceDate', 'priceSource', 'previousClose', 'updatedAt', 'isActive', 'failCount', 'lastFailDate',
      'marketCap', 'liquidity', 'name',
    ]);
    expect(set).toEqual({
      lastPrice: 90000, change: 2, priceDate: '2026-11-18', priceSource: 'YAHOO', previousClose: 88235.29,
      updatedAt: NOW, isActive: true, failCount: 0, lastFailDate: null, marketCap: 1.8e12, liquidity: 1000, name: 'Bitcoin USD',
    });
  });

  it('STOCK_US/ETF: liquidez em valor (volume × preço); nome bom não é sobrescrito', async () => {
    mockFind([
      stale({ ticker: 'AAPL', type: 'STOCK_US', name: 'Apple Inc.' }),
      stale({ ticker: 'IVVB11', type: 'ETF', name: 'IVVB11' }),
    ]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'AAPL', price: 200, change: 1, marketTime: NOW, volume: 10, name: 'Apple' },
      { ticker: 'IVVB11', price: 400, change: 0.5, marketTime: NOW, volume: 3, marketCap: 0, name: 'iShares S&P 500' },
    ]);
    await marketDataService.refreshQuotesBatch(['AAPL', 'IVVB11'], false);
    expect(setOf('AAPL')).toMatchObject({ liquidity: 2000, priceSource: 'YAHOO' });
    expect(setOf('AAPL').name).toBeUndefined();
    expect(setOf('AAPL').marketCap).toBeUndefined();
    expect(setOf('IVVB11')).toMatchObject({ liquidity: 1200, name: 'iShares S&P 500' });
    expect('marketCap' in setOf('IVVB11')).toBe(false);
  });

  it('STOCK: sem marketCap/liquidez; nome igual ao ticker é ignorado; change ausente vira 0', async () => {
    mockFind([stale({ ticker: 'PETR4', type: 'STOCK', name: 'PETR4' })]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'PETR4.SA', price: 40, marketTime: NOW, volume: 100, marketCap: 5e11, name: 'petr4' },
    ]);
    await marketDataService.refreshQuotesBatch(['PETR4'], false);
    const set = setOf('PETR4');
    expect(set.change).toBe(0);
    expect(set.marketCap).toBeUndefined();
    expect(set.liquidity).toBeUndefined();
    expect(set.name).toBeUndefined();
  });

  it('ativo sem documento, com preço 0 ou forçado é perguntado; fresco sem force não', async () => {
    mockFind([
      { ticker: 'ZERO3', updatedAt: minutesAgo(1), lastPrice: 0, isActive: true, failCount: 0 },
      { ticker: 'FRSH3', updatedAt: minutesAgo(1), lastPrice: 5, isActive: true, failCount: 0 },
    ]);
    externalMarketService.getQuotes.mockResolvedValue([]);
    await marketDataService.refreshQuotesBatch(['NOVO3', 'ZERO3', 'FRSH3', 'novo3'], false);
    expect(externalMarketService.getQuotes.mock.calls[0][0]).toEqual(['NOVO3', 'ZERO3']);
    const typeMap = externalMarketService.getQuotes.mock.calls[0][1].typeByTicker;
    expect([...typeMap]).toEqual([['ZERO3', null], ['FRSH3', null]]);

    vi.clearAllMocks();
    mockFind([{ ticker: 'FRSH3', updatedAt: minutesAgo(1), lastPrice: 5, isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([]);
    await marketDataService.refreshQuotesBatch(['FRSH3'], true);
    expect(externalMarketService.getQuotes.mock.calls[0][0]).toEqual(['FRSH3']);
  });

  it('lista vazia não toca o banco', async () => {
    await marketDataService.refreshQuotesBatch([], true);
    await marketDataService.refreshQuotesBatch(null, true);
    expect(MarketAsset.find).not.toHaveBeenCalled();
  });
});

describe('refreshQuotesBatch — caracterização dos caminhos de não-sucesso', () => {
  it('eco, sessão velha e preço 0 viram falha, nomeados no log; sucesso vem antes das falhas', async () => {
    mockFind([
      stale({ ticker: 'ECO3', lastPrice: 7 }),
      stale({ ticker: 'OLD3' }),
      stale({ ticker: 'NIL3' }),
      stale({ ticker: 'OK3' }),
    ]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'ECO3', price: 7 },
      { ticker: 'OLD3', price: 11, marketTime: new Date('2026-10-01T20:00:00Z') },
      { ticker: 'NIL3', price: 0 },
      { ticker: 'OK3', price: 12, marketTime: NOW },
    ]);
    await marketDataService.refreshQuotesBatch(['ECO3', 'OLD3', 'NIL3', 'OK3'], false);
    expect(ops().map((o) => o.updateOne.filter.ticker)).toEqual(['OK3', 'ECO3', 'OLD3', 'NIL3']);
    expect(setOf('ECO3').failCount).toBe(1);
    expect(setOf('ECO3').lastPrice).toBeUndefined();
    expect(warnedWith('echoed')[1]).toEqual({ echoed: ['ECO3'] });
    expect(warnedWith('stale')[1]).toEqual({ stale: ['OLD3@2026-10-01'] });
    expect(warnedWith('noTrade')).toBeUndefined();
    expect(warnedWith('suspects')).toBeUndefined();
  });

  it('sem negócio no pregão em curso é alerta (warn); nada de debug', async () => {
    mockFind([stale({ ticker: 'AERO11', type: 'FII' })]);
    externalMarketService.getQuotes.mockResolvedValue([{ ticker: 'AERO11', price: 10, marketTime: NOW, volume: 0 }]);
    await marketDataService.refreshQuotesBatch(['AERO11'], false);
    expect(warnedWith('noTrade')[1]).toEqual({ noTrade: ['AERO11@2026-11-18'] });
    expect(logger.debug.mock.calls.find((c) => c[1]?.noTradeExpected)).toBeUndefined();
  });

  it('sem negócio fora do pregão vai para debug e não vira falha', async () => {
    vi.setSystemTime(new Date('2026-11-22T15:49:00-03:00'));
    mockFind([stale({ ticker: 'MGLU3', type: 'STOCK', updatedAt: new Date('2026-11-22T14:00:00-03:00') })]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'MGLU3', price: 8.2, marketTime: new Date('2026-11-19T21:05:49Z'), volume: 0 },
    ]);
    await marketDataService.refreshQuotesBatch(['MGLU3'], false);
    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled();
    expect(logger.debug.mock.calls.find((c) => c[1]?.noTradeExpected)[1]).toEqual({ noTradeExpected: ['MGLU3@2026-11-19'] });
    expect(warnedWith('noTrade')).toBeUndefined();
  });

  it('erro da fonte cai no catch: loga e não grava', async () => {
    mockFind([stale({ ticker: 'PETR4' })]);
    externalMarketService.getQuotes.mockRejectedValue(new Error('fora do ar'));
    await expect(marketDataService.refreshQuotesBatch(['PETR4'], false)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('❌ [MarketData] Falha: fora do ar');
    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled();
  });

  it('detecção de provento recebe as cotações e o mapa de ativos, depois do bulkWrite', async () => {
    const order = [];
    MarketAsset.bulkWrite.mockImplementation(async () => { order.push('bulkWrite'); });
    const spy = vi.spyOn(marketDataService, 'detectExDateDividends').mockImplementation(async () => { order.push('dividends'); return 0; });
    mockFind([stale({ ticker: 'OK3' })]);
    const quotes = [{ ticker: 'OK3', price: 12, marketTime: NOW }];
    externalMarketService.getQuotes.mockResolvedValue(quotes);
    await marketDataService.refreshQuotesBatch(['OK3'], false);
    expect(order).toEqual(['bulkWrite', 'dividends']);
    expect(spy.mock.calls[0][0]).toBe(quotes);
    expect([...spy.mock.calls[0][1].keys()]).toEqual(['OK3']);
  });
});

describe('getMarketData — caracterização do item', () => {
  const snapshots = (rows) => FundamentalSnapshot.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(rows) }) });

  it('REIT completo: setor de exibição, métricas com fallback e flags de dado ausente', async () => {
    snapshots([]);
    MarketAsset.find.mockResolvedValue([{
      ticker: 'O', type: 'STOCK_US', usSubType: 'REIT', industry: 'REIT - Retail', sector: 'Real Estate',
      lastPrice: 55, p_vp: 1.2, liquidity: 9e8, dy: 5.5, pl: 50, roe: 0, beta: 0.9, isBlacklisted: false, isTier1: true,
      lastFundamentalsDate: new Date('2026-11-08T15:00:00-03:00'),
      sectorMetrics: { toObject: () => ({ a: 1 }) }, stockArchetype: 'REIT',
    }]);
    const [item] = await marketDataService.getMarketData('REIT');
    expect(Object.keys(item)).toEqual([
      'ticker', 'type', 'allocationClass', 'currency', 'name', 'sector', 'stockArchetype', 'sectorMetrics',
      'fiiSubType', 'usSubType', 'price', 'dbFlags', 'metrics',
    ]);
    expect(Object.keys(item.metrics)).toEqual([
      'ticker', 'price', 'dy', 'pvp', 'marketCap', 'avgLiquidity', 'pl', 'roe', 'roic', 'netMargin', 'evEbitda',
      'revenueGrowth', 'debtToEquity', 'netDebt', 'payout', 'netRevenue', 'netIncome', 'totalAssets', 'patrimLiq',
      'vacancy', 'capRate', 'qtdImoveis', 'ffoYield', 'vpCota', 'ffoCota', 'volatility', 'beta', 'sma200', 'ema50',
      'sector', 'fiiSubType', '_missing', '_staleDays', 'dataCompleteness', 'trackRecord', 'structural',
    ]);
    expect(Object.keys(item.metrics._missing)).toEqual([
      'pl', 'marketCap', 'roe', 'netMargin', 'revenueGrowth', 'evEbitda', 'beta', 'dy', 'debtToEquity', 'payout',
    ]);
    expect(item).toMatchObject({
      ticker: 'O', type: 'STOCK_US', allocationClass: null, currency: 'USD', name: 'O', stockArchetype: 'REIT',
      sectorMetrics: { a: 1 }, fiiSubType: null, usSubType: 'REIT', price: 55, dbFlags: { isBlacklisted: false, isTier1: true },
    });
    expect(item.sector).not.toBe('Real Estate');
    expect(item.metrics).toMatchObject({
      ticker: 'O', price: 55, dy: 5.5, pvp: 1.2, marketCap: 0, avgLiquidity: 9e8, pl: 50, roe: 0, roic: 0, beta: 0.9,
      sector: 'Real Estate', fiiSubType: null, _staleDays: 10, dataCompleteness: 17, trackRecord: null,
      structural: { quality: 50, valuation: 50, risk: 50 },
      _missing: {
        pl: false, marketCap: true, roe: true, netMargin: true, revenueGrowth: true, evEbitda: true, beta: false,
        dy: false, debtToEquity: false, payout: false,
      },
    });
    expect(item.metrics.ffoCota).toBe(0);
    expect(item.metrics.ema50).toBe(0);
  });

  it('BRASIL_10 deduplica pela raiz e fica com a maior liquidez; track record por ticker', async () => {
    snapshots([{ ticker: 'ITUB4', history: [] }]);
    MarketAsset.find.mockResolvedValue([
      { ticker: 'ITUB3', type: 'STOCK', sector: 'Bancos', lastPrice: 30, avgLiquidity: 1e6, currency: 'BRL', name: 'Itaú ON' },
      { ticker: 'ITUB4', type: 'STOCK', sector: 'Bancos', lastPrice: 32, avgLiquidity: 5e8, sectorMetrics: { x: 2 } },
      { ticker: 'HGLG11', type: 'FII', sector: 'Logística', fiiSubType: 'TIJOLO' },
    ]);
    const out = await marketDataService.getMarketData('BRASIL_10');
    expect(MarketAsset.find.mock.calls[0][0]).toEqual({ type: { $in: ['STOCK', 'FII'] }, isIgnored: false, isBlacklisted: false, isActive: true });
    expect(out.map((a) => a.ticker)).toEqual(['ITUB4', 'HGLG11']);
    expect(out[0]).toMatchObject({ currency: 'BRL', name: 'ITUB4', sector: 'Bancos', sectorMetrics: { x: 2 }, stockArchetype: null });
    expect(out[0].metrics._staleDays).toBeNull();
    expect(out[0].metrics.trackRecord).toBeNull(); // série vazia → sem resumo
    expect(out[1]).toMatchObject({ fiiSubType: 'TIJOLO', price: 0, sectorMetrics: {} });
    expect(out[1].metrics).toMatchObject({ fiiSubType: 'TIJOLO', price: undefined, dataCompleteness: 0 });
  });

  it('falha no track record não derruba a classe; classe desconhecida volta vazia sem consulta', async () => {
    FundamentalSnapshot.find.mockImplementation(() => { throw new Error('sem banco'); });
    MarketAsset.find.mockResolvedValue([{ ticker: 'BTC', type: 'CRYPTO', lastPrice: 1 }]);
    const out = await marketDataService.getMarketData('CRYPTO');
    expect(out).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith('[MarketData] Falha ao carregar track record: sem banco');
    expect(MarketAsset.find.mock.calls[0][0]).toMatchObject({ type: { $in: ['CRYPTO'] } });

    MarketAsset.find.mockClear();
    expect(await marketDataService.getMarketData('XYZ')).toEqual([]);
    expect(MarketAsset.find).not.toHaveBeenCalled();
  });
});
