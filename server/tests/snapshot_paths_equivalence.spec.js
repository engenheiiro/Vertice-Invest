/**
 * EQUIVALÊNCIA DOS DOIS CAMINHOS DE SNAPSHOT.
 *
 * Existem dois produtores de WalletSnapshot:
 *   - job diário  → schedulerService.persistUserSnapshotForDay (incremental, 23:59)
 *   - rebuild     → financialService.rebuildUserHistory (replay completo)
 *
 * O rebuild é disparado sozinho por transação retroativa, reclassificação de renda
 * fixa, remoção de ativo/transação e por backfillUserGap. Se os dois caminhos
 * marcarem a carteira de formas diferentes, qualquer um desses eventos reescreve a
 * rentabilidade histórica do usuário sem aviso.
 *
 * Este teste roda o job diário dia a dia sobre uma carteira sintética e exige que o
 * rebuild reproduza EXATAMENTE a mesma série (patrimônio, custo, proventos e cota).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  txFind: vi.fn(),
  userAssetFind: vi.fn(),
  systemConfigFindOne: vi.fn(),
  snapshotFindOne: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  snapshotExists: vi.fn(),
  dividendFind: vi.fn(),
  assetHistoryAggregate: vi.fn(),
  getMarketDataMap: vi.fn(),
  upsertSnapshot: vi.fn(),
  isHoliday: vi.fn(() => false),
}));

// ---- modelos ----
vi.mock('../models/AssetTransaction.js', () => ({ default: { find: mocks.txFind } }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: mocks.userAssetFind } }));
vi.mock('../models/SystemConfig.js', () => ({
  default: { findOne: mocks.systemConfigFindOne, findOneAndUpdate: vi.fn() },
}));
vi.mock('../models/WalletSnapshot.js', () => ({
  default: {
    findOne: mocks.snapshotFindOne,
    deleteMany: mocks.snapshotDeleteMany,
    exists: mocks.snapshotExists,
  },
}));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: mocks.dividendFind } }));
vi.mock('../models/AssetHistory.js', () => ({ default: { aggregate: mocks.assetHistoryAggregate } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn(), findOne: vi.fn() } }));
vi.mock('../models/EconomicIndex.js', () => ({ default: { find: vi.fn(() => ({ lean: () => [] })) } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({ default: {} }));
vi.mock('../models/RefreshToken.js', () => ({ default: {} }));

// ---- serviços vizinhos (não exercitados aqui) ----
vi.mock('../services/marketDataService.js', () => ({
  marketDataService: { getMarketDataMap: mocks.getMarketDataMap },
}));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: { getFullHistory: vi.fn() } }));
vi.mock('../services/aiResearchService.js', () => ({ aiResearchService: {} }));
vi.mock('../services/macroDataService.js', () => ({ macroDataService: {} }));
vi.mock('../services/syncService.js', () => ({ syncService: {} }));
vi.mock('../services/holidayService.js', () => ({ holidayService: { isHoliday: mocks.isHoliday, sync: vi.fn() } }));
vi.mock('../services/engines/signalEngine.js', () => ({ signalEngine: {} }));
vi.mock('../services/notificationService.js', () => ({ createBroadcast: vi.fn() }));
vi.mock('../services/researchPublicationService.js', () => ({
  activateResearchSections: vi.fn(), hasSectionContent: vi.fn(),
}));
vi.mock('../services/workers/timeSeriesWorker.js', () => ({ timeSeriesWorker: {} }));
vi.mock('../services/usStocksFundamentalsService.js', () => ({ usStocksFundamentalsService: {} }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Upsert real substituído por captura do payload — o teste compara números.
vi.mock('../utils/walletSnapshot.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, upsertWalletSnapshotForDay: mocks.upsertSnapshot };
});

const { financialService } = await import('../services/financialService.js');
const { persistUserSnapshotForDay } = await import('../services/schedulerService.js');

// ---------------------------------------------------------------- carteira
const TICKER = 'TEST3';
const WALLET = { _id: 'w1', user: 'u1', name: 'Sintética' };
const BUY = {
  ticker: TICKER, type: 'BUY', quantity: 10, price: 10,
  totalValue: 100, currency: 'BRL', date: new Date('2026-07-01T12:00:00Z'),
};
const POSITION = {
  ticker: TICKER, type: 'STOCK', currency: 'BRL',
  quantity: 10, totalCost: 100, totalCostBrl: 100,
};
// Fechamentos de 01→10/07/2026 (04 e 05 são sábado/domingo — sem candle, como na B3).
const CLOSES = {
  '2026-07-01': 10.0, '2026-07-02': 10.4, '2026-07-03': 10.2,
  '2026-07-06': 10.9, '2026-07-07': 10.5, '2026-07-08': 11.3,
  '2026-07-09': 11.1, '2026-07-10': 11.6,
};
const DIVIDEND = { ticker: TICKER, type: 'DIVIDEND', amount: 0.4, date: new Date(Date.UTC(2026, 6, 7)) };
const BUSINESS_DAYS = Object.keys(CLOSES);

const candles = Object.entries(CLOSES).map(([date, close]) => ({ date, close, adjClose: close }));

describe('WalletSnapshot — job diário e rebuild produzem a MESMA série', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.systemConfigFindOne.mockResolvedValue({ cdi: 14, selic: 14.25, ipca: 4.5, dollar: 5 });
    mocks.userAssetFind.mockImplementation(() => {
      const result = [POSITION];
      result.select = () => ({ lean: async () => [{ ticker: TICKER, type: 'STOCK' }] });
      return Object.assign(Promise.resolve(result), result);
    });
    mocks.snapshotDeleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.snapshotExists.mockResolvedValue(false);
    mocks.getMarketDataMap.mockResolvedValue(new Map());
    mocks.upsertSnapshot.mockImplementation(async (_m, _w, _d, payload) => ({ ...payload, _id: 'snap' }));

    vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(() => 5);
    vi.spyOn(financialService, '_loadPriceCacheMap')
      .mockResolvedValue(new Map([[TICKER, financialService.indexHistoryByDate(candles)]]));
    vi.spyOn(financialService, '_loadDividendDateMap')
      .mockResolvedValue(new Map([['2026-07-07', [DIVIDEND]]]));
    vi.spyOn(financialService, '_loadCdiFactors')
      .mockResolvedValue({ dailyFactorsMap: new Map(), cdiFactorsCacheFallback: { 2026: 1.0005 } });
    vi.spyOn(financialService, '_persistSnapshots').mockResolvedValue();
  });

  afterEach(() => vi.restoreAllMocks());

  /** Roda o job diário dia a dia, realimentando o snapshot anterior. */
  const runDailyChain = async () => {
    const produced = [];
    for (const day of BUSINESS_DAYS) {
      const previous = produced.at(-1) || null;
      mocks.snapshotFindOne.mockReturnValue({ sort: () => Promise.resolve(previous) });
      // Fluxo do dia: só a compra do 1º dia ainda não incorporada.
      mocks.txFind.mockResolvedValue(previous ? [] : [BUY]);
      mocks.dividendFind.mockReturnValue({
        lean: async () => (day === '2026-07-07' ? [DIVIDEND] : []),
      });
      mocks.assetHistoryAggregate.mockResolvedValue([{ ticker: TICKER, candle: { close: CLOSES[day] } }]);
      // Cotação em cache propositalmente defasada: se o diário voltar a marcar por
      // ela em vez do fechamento, a série diverge do rebuild e este teste quebra.
      mocks.getMarketDataMap.mockResolvedValue(new Map([[TICKER, { price: CLOSES[day] * 0.97 }]]));
      // Proventos acumulados: mesma fonte que o rebuild usa.
      vi.spyOn(financialService, 'accruedDividendsThroughDay')
        .mockResolvedValue(day >= '2026-07-07' ? 4 : 0);

      const ctx = await (await import('../services/schedulerService.js')).loadSnapshotContext(day);
      const result = await persistUserSnapshotForDay(WALLET, day, ctx);
      expect(result).toBe('created');
      produced.push(mocks.upsertSnapshot.mock.calls.at(-1)[3]);
    }
    return produced;
  };

  it('patrimônio, custo, proventos e cota batem dia a dia', async () => {
    const daily = await runDailyChain();

    mocks.txFind.mockReturnValue({ sort: () => Promise.resolve([BUY]) });
    mocks.userAssetFind.mockResolvedValue([POSITION]);
    const rebuilt = await financialService.rebuildUserHistory('u1', 'w1', {
      dryRun: true, throughDayKey: '2026-07-10',
    });

    expect(rebuilt.map((s) => s.dayKey)).toEqual(BUSINESS_DAYS);

    for (let i = 0; i < BUSINESS_DAYS.length; i++) {
      const day = BUSINESS_DAYS[i];
      expect.soft(daily[i].totalEquity, `${day} totalEquity`).toBeCloseTo(rebuilt[i].totalEquity, 2);
      expect.soft(daily[i].totalInvested, `${day} totalInvested`).toBeCloseTo(rebuilt[i].totalInvested, 2);
      expect.soft(daily[i].totalDividends, `${day} totalDividends`).toBeCloseTo(rebuilt[i].totalDividends, 2);
      expect.soft(daily[i].quotaPrice, `${day} quotaPrice`).toBeCloseTo(rebuilt[i].quotaPrice, 4);
    }
  });

  it('marca pelo FECHAMENTO do dia, não pela cotação em cache do momento do cron', async () => {
    // Cotação em cache 2% abaixo do fechamento (caso real: FII pouco líquido).
    mocks.getMarketDataMap.mockResolvedValue(new Map([[TICKER, { price: 9.8 }]]));
    mocks.assetHistoryAggregate.mockResolvedValue([{ ticker: TICKER, candle: { close: 10.4 } }]);
    mocks.snapshotFindOne.mockReturnValue({ sort: () => Promise.resolve(null) });
    mocks.txFind.mockResolvedValue([BUY]);
    mocks.dividendFind.mockReturnValue({ lean: async () => [] });
    vi.spyOn(financialService, 'accruedDividendsThroughDay').mockResolvedValue(0);

    const ctx = await (await import('../services/schedulerService.js')).loadSnapshotContext('2026-07-02');
    await persistUserSnapshotForDay(WALLET, '2026-07-02', ctx);

    expect(mocks.upsertSnapshot.mock.calls.at(-1)[3].totalEquity).toBeCloseTo(104, 2); // 10 × 10,40
  });

  it('sem candle do dia, cai na cotação corrente em vez de zerar a posição', async () => {
    mocks.getMarketDataMap.mockResolvedValue(new Map([[TICKER, { price: 9.8 }]]));
    mocks.assetHistoryAggregate.mockResolvedValue([]); // cripto às 23:59, candle ainda não fechado
    mocks.snapshotFindOne.mockReturnValue({ sort: () => Promise.resolve(null) });
    mocks.txFind.mockResolvedValue([BUY]);
    mocks.dividendFind.mockReturnValue({ lean: async () => [] });
    vi.spyOn(financialService, 'accruedDividendsThroughDay').mockResolvedValue(0);

    const ctx = await (await import('../services/schedulerService.js')).loadSnapshotContext('2026-07-02');
    await persistUserSnapshotForDay(WALLET, '2026-07-02', ctx);

    expect(mocks.upsertSnapshot.mock.calls.at(-1)[3].totalEquity).toBeCloseTo(98, 2); // 10 × 9,80
  });
});

describe('accruedDividendsThroughDay — proventos pela quantidade da época', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(financialService, '_loadDividendDateMap').mockResolvedValue(new Map([
      ['2026-07-07', [{ ticker: TICKER, amount: 0.4, type: 'DIVIDEND' }]],
      ['2026-08-07', [{ ticker: TICKER, amount: 0.4, type: 'DIVIDEND' }]],
    ]));
  });

  afterEach(() => vi.restoreAllMocks());

  it('usa a posição de cada ex-date, não a de hoje', async () => {
    // 10 cotas no 1º provento, 20 no segundo → 4 + 8 = 12 (e não 20×0,4×2 = 16,
    // que era o número que o job diário gravava via calculateUserDividends).
    mocks.txFind.mockReturnValue({ sort: () => Promise.resolve([
      BUY,
      { ...BUY, quantity: 10, totalValue: 200, price: 20, date: new Date('2026-08-01T12:00:00Z') },
    ]) });

    await expect(financialService.accruedDividendsThroughDay('u1', 'w1', '2026-08-31')).resolves.toBeCloseTo(12, 2);
  });

  it('não conta ex-date posterior ao dia consultado', async () => {
    mocks.txFind.mockReturnValue({ sort: () => Promise.resolve([BUY]) });
    await expect(financialService.accruedDividendsThroughDay('u1', 'w1', '2026-07-31')).resolves.toBeCloseTo(4, 2);
  });

  it('posição zerada antes da ex-date não recebe provento', async () => {
    mocks.txFind.mockReturnValue({ sort: () => Promise.resolve([
      BUY,
      { ...BUY, type: 'SELL', date: new Date('2026-07-02T12:00:00Z') },
    ]) });
    await expect(financialService.accruedDividendsThroughDay('u1', 'w1', '2026-08-31')).resolves.toBe(0);
  });
});
