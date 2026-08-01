import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ assetHistoryFindOne: vi.fn() }));

vi.mock('../models/AssetHistory.js', () => ({ default: { findOne: mocks.assetHistoryFindOne } }));
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/DividendEvent.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: {} }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { financialService } = await import('../services/financialService.js');

describe('financialService V5 — preços históricos', () => {
  it('usa preço exato, depois último preço de até cinco dias, nunca preço futuro', () => {
    const prices = new Map([
      ['2026-07-24', { close: 10, adjClose: 9.8 }],
      ['2026-07-27', { close: 11, adjClose: 10.8 }],
      ['2026-07-31', { close: 20, adjClose: 20 }],
    ]);
    expect(financialService.findPriceInMap(prices, '2026-07-27')).toEqual({ close: 11, adjClose: 10.8 });
    expect(financialService.findPriceInMap(prices, '2026-07-28')).toEqual({ close: 11, adjClose: 10.8 });
    expect(financialService.findPriceInMap(prices, '2026-07-30')).toEqual({ close: 11, adjClose: 10.8 });
    expect(financialService.findPriceInMap(prices, '2026-07-23')).toEqual({ close: 0, adjClose: 0 });
  });

  it('entrada vazia ou data inválida falha fechado com preço zero', () => {
    expect(financialService.findPriceInMap(null, '2026-07-30')).toEqual({ close: 0, adjClose: 0 });
    expect(financialService.findPriceInMap(new Map([['x', { close: 1 }]]), 'inválida'))
      .toEqual({ close: 0, adjClose: 0 });
  });

  it('indexa adjClose com fallback para close', () => {
    expect(financialService.indexHistoryByDate([
      { date: '2026-07-30', close: 10, adjClose: 0 },
      { date: '2026-07-31', close: 11, adjClose: 10.5 },
      { close: 99 },
    ])).toEqual(new Map([
      ['2026-07-30', { close: 10, adjClose: 10 }],
      ['2026-07-31', { close: 11, adjClose: 10.5 }],
    ]));
  });
});

describe('financialService V5 — resolver histórico USD/BRL', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolve exato, gap pela taxa anterior, antes da série pela primeira e depois pela última', async () => {
    mocks.assetHistoryFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({
      history: [
        { date: '2026-07-01', close: 5.4 },
        { date: '2026-07-10', adjClose: 5.5 },
        { date: '2026-07-20', close: 5.3 },
      ],
    }) });
    const resolve = await financialService._loadUsdRateResolver(5.75);
    expect(resolve('2026-07-10')).toBe(5.5);
    expect(resolve('2026-07-15')).toBe(5.5);
    expect(resolve('2026-06-01')).toBe(5.4);
    expect(resolve('2026-08-01')).toBe(5.3);
  });

  it('ignora candles corrompidos e usa fallback atual saneado', async () => {
    mocks.assetHistoryFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({
      history: [
        { date: '2026-02-30', close: 5 },
        { date: '2026-07-01', close: Infinity },
        { date: '2026-07-02', close: -1 },
      ],
    }) });
    const resolve = await financialService._loadUsdRateResolver(Infinity);
    expect(resolve('2026-07-15')).toBe(5.75);
    expect(() => resolve('data inválida')).toThrow('Data de câmbio inválida');
  });
});

describe('financialService V5 — aplicação de transações', () => {
  const day = '2026-07-30';
  const tx = (override = {}) => ({
    ticker: 'BTC',
    type: 'BUY',
    quantity: 0.001,
    price: 10_000,
    totalValue: 10,
    currency: 'USD',
    date: new Date(`${day}T12:00:00Z`),
    ...override,
  });
  const context = (transactions, metadata = new Map(), rate = () => 5) => ({
    txs: transactions,
    txIndex: 0,
    cursorIso: day,
    portfolio: {},
    fixedIncomeState: {},
    assetMetadataMap: metadata,
    priceCacheMap: new Map(),
    lastKnownPrices: {},
    getUsdRateForDate: rate,
  });

  it('usa currency persistida mesmo sem UserAsset atual', () => {
    const ctx = context([tx()]);
    const result = financialService._applyDayTransactions(ctx);
    expect(result.dayFlowNominal).toBe(50);
    expect(ctx.portfolio.BTC).toMatchObject({ qty: 0.001, cost: 10 });
  });

  it('currency BRL persistida prevalece sobre metadado CRYPTO', () => {
    const metadata = new Map([['BTC', { ticker: 'BTC', type: 'CRYPTO' }]]);
    const result = financialService._applyDayTransactions(context([tx({ currency: 'BRL' })], metadata));
    expect(result.dayFlowNominal).toBe(10);
  });

  it('lançamento legado usa o tipo da posição como fallback', () => {
    const metadata = new Map([['BTC', { ticker: 'BTC', type: 'CRYPTO' }]]);
    const result = financialService._applyDayTransactions(context([tx({ currency: undefined })], metadata));
    expect(result.dayFlowNominal).toBe(50);
  });

  it('compra e venda total zeram posição e fluxo líquido', () => {
    const ctx = context([
      tx(),
      tx({ type: 'SELL' }),
    ]);
    const result = financialService._applyDayTransactions(ctx);
    expect(result).toMatchObject({ txIndex: 2, dayFlowNominal: 0 });
    expect(ctx.portfolio.BTC).toEqual({ qty: 0, cost: 0 });
  });

  it('não processa transação de dia futuro', () => {
    const ctx = context([tx({ date: new Date('2026-07-31T12:00:00Z') })]);
    expect(financialService._applyDayTransactions(ctx)).toMatchObject({ txIndex: 0, dayFlowNominal: 0 });
    expect(ctx.portfolio).toEqual({});
  });

  it('câmbio inválido interrompe rebuild em vez de produzir NaN', () => {
    expect(() => financialService._applyDayTransactions(context([tx()], new Map(), () => 0)))
      .toThrow('Câmbio USD/BRL inválido');
  });
});

describe('financialService V5 — marcação a mercado', () => {
  it('usa custo médio quando não há candle nem último preço', () => {
    const result = financialService._markPortfolioToMarket({
      cursorIso: '2026-07-30',
      portfolio: { PETR4: { qty: 10, cost: 300 } },
      fixedIncomeState: {},
      assetMetadataMap: new Map([['PETR4', { type: 'STOCK' }]]),
      priceCacheMap: new Map(),
      lastKnownPrices: {},
      usdRateForDay: 5,
    });
    expect(result).toMatchObject({ totalEquityNominal: 300, totalInvested: 300, hasPosition: true });
  });

  it('converte posição americana e custo pelo mesmo câmbio', () => {
    const result = financialService._markPortfolioToMarket({
      cursorIso: '2026-07-30',
      portfolio: { AAPL: { qty: 2, cost: 300 } },
      fixedIncomeState: {},
      assetMetadataMap: new Map([['AAPL', { type: 'STOCK_US' }]]),
      priceCacheMap: new Map([['AAPL', new Map([['2026-07-30', { close: 200, adjClose: 195 }]])]]),
      lastKnownPrices: {},
      usdRateForDay: 5,
    });
    expect(result).toMatchObject({
      totalEquityNominal: 2_000,
      totalEquityAdjusted: 1_950,
      totalInvested: 1_500,
    });
  });
});
