/**
 * CANDLE DE FECHAMENTO GARANTIDO ANTES DO SNAPSHOT PATRIMONIAL.
 *
 * O snapshot marca a renda variável pelo fechamento do dia lido de AssetHistory
 * e só cai no preço corrente (instante do cron, 23:59) quando o candle não
 * existe. Como a série atrasa por design — o timeSeriesWorker só re-busca acima
 * de HISTORY_MAX_CANDLE_AGE_DAYS e não completa o universo de ~1.264 ativos — o
 * fallback virou a REGRA para boa parte do patrimônio: em 19/08/2026, BOVA11 e
 * IVVB11 (68% da renda variável de uma carteira real) foram marcados assim, e o
 * snapshot ficou R$ 14,86 abaixo do fechamento implícito nas cotações. Isso não
 * é cosmético: WalletSnapshot é a base do TWRR e do Sharpe.
 *
 * A garantia roda logo antes do snapshot e SÓ para os tickers que estão em
 * carteiras de verdade — algumas dezenas — para o run continuar barato.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  txFind: vi.fn(),
  userAssetFind: vi.fn(),
  marketAssetFind: vi.fn(),
  systemConfigFindOne: vi.fn(),
  snapshotFindOne: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  snapshotExists: vi.fn(),
  dividendFind: vi.fn(),
  historyAggregate: vi.fn(),
  historyFind: vi.fn(),
  historyUpdateOne: vi.fn(),
  getMarketDataMap: vi.fn(),
  getFullHistoryDetailed: vi.fn(),
  upsertSnapshot: vi.fn(),
  loggerWarn: vi.fn(),
}));

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
vi.mock('../models/AssetHistory.js', () => ({
  default: {
    aggregate: mocks.historyAggregate,
    find: mocks.historyFind,
    updateOne: mocks.historyUpdateOne,
    findOne: vi.fn(() => ({ lean: async () => null })),
  },
}));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: mocks.marketAssetFind, findOne: vi.fn() } }));
vi.mock('../models/EconomicIndex.js', () => ({ default: { find: vi.fn(() => ({ lean: () => [] })) } }));
vi.mock('../models/AuditLog.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../models/MarketAnalysis.js', () => ({ default: {} }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({ default: {} }));
vi.mock('../models/RefreshToken.js', () => ({ default: {} }));

vi.mock('../services/marketDataService.js', () => ({
  marketDataService: { getMarketDataMap: mocks.getMarketDataMap },
}));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getFullHistoryDetailed: mocks.getFullHistoryDetailed },
}));
vi.mock('../services/aiResearchService.js', () => ({ aiResearchService: {} }));
vi.mock('../services/macroDataService.js', () => ({ macroDataService: {} }));
vi.mock('../services/syncService.js', () => ({ syncService: {} }));
vi.mock('../services/holidayService.js', () => ({ holidayService: { isHoliday: () => false, sync: vi.fn() } }));
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
  default: { info: vi.fn(), error: vi.fn(), warn: mocks.loggerWarn, debug: vi.fn() },
}));

vi.mock('../utils/walletSnapshot.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, upsertWalletSnapshotForDay: mocks.upsertSnapshot };
});

const { financialService } = await import('../services/financialService.js');
const { loadSnapshotContext, persistUserSnapshotForDay } = await import('../services/schedulerService.js');

const DAY = '2026-08-19'; // quarta-feira
const WALLET = { _id: 'w1', user: 'u1', name: 'Principal' };

// Posições: um ETF em carteira, uma cripto que já tem candle do dia e uma
// posição zerada (não pesa no patrimônio — não pode custar uma busca externa).
const HELD_ETF = { ticker: 'BOVA11', type: 'ETF', currency: 'BRL', quantity: 10, totalCost: 1000, totalCostBrl: 1000 };
const HELD_CRYPTO = { ticker: 'BTC', type: 'CRYPTO', currency: 'USD', quantity: 0.01, totalCost: 100, totalCostBrl: 500 };
const SOLD_OUT = { ticker: 'MXRF11', type: 'FII', currency: 'BRL', quantity: 0, totalCost: 0, totalCostBrl: 0 };

const wireUserAssets = (positions) => {
  mocks.userAssetFind.mockImplementation((filter = {}) => {
    const result = filter.type === 'FIXED_INCOME' ? [] : positions;
    const chain = { select: () => ({ lean: async () => result }) };
    return Object.assign(Promise.resolve(result), chain);
  });
};

/** Payload de `getFullHistoryDetailed`: a série mais as datas que vieram VAZIAS. */
const sourcePayload = (candles, emptyDates = []) => ({ candles, emptyDates });

const seriesThrough = (lastDay, lastClose) => [
  { date: '2026-08-17', close: lastClose * 0.98, adjClose: lastClose * 0.98, volume: 100 },
  { date: '2026-08-18', close: lastClose * 0.99, adjClose: lastClose * 0.99, volume: 100 },
  { date: lastDay, close: lastClose, adjClose: lastClose, volume: 120 },
];

describe('Snapshot diário — candle do dia garantido para ativos em carteira', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.systemConfigFindOne.mockResolvedValue({ cdi: 14, selic: 14.25, ipca: 4.5, dollar: 5 });
    mocks.snapshotDeleteMany.mockResolvedValue({ deletedCount: 0 });
    mocks.snapshotExists.mockResolvedValue(false);
    mocks.snapshotFindOne.mockReturnValue({ sort: () => Promise.resolve(null) });
    mocks.txFind.mockResolvedValue([]);
    mocks.dividendFind.mockReturnValue({ lean: async () => [] });
    mocks.historyUpdateOne.mockResolvedValue({ acknowledged: true });
    mocks.historyFind.mockReturnValue({ lean: async () => [] });
    mocks.upsertSnapshot.mockImplementation(async (_m, _w, _d, payload) => ({ ...payload, _id: 'snap' }));
    vi.spyOn(financialService, '_loadUsdRateResolver').mockResolvedValue(() => 5);
    vi.spyOn(financialService, 'accruedDividendsThroughDay').mockResolvedValue(0);
  });

  it('(a) busca o candle faltante e marca o snapshot pelo FECHAMENTO, não pelo preço das 23:59', async () => {
    wireUserAssets([HELD_ETF]);
    mocks.historyAggregate.mockResolvedValue([]); // série sem o candle de hoje
    mocks.historyFind.mockReturnValue({
      lean: async () => [{ ticker: 'BOVA11', history: [{ date: '2026-08-17', close: 98, adjClose: 98, volume: 10 }] }],
    });
    mocks.getMarketDataMap.mockResolvedValue(new Map([['BOVA11', { price: 99.2 }]])); // preço corrente defasado
    mocks.getFullHistoryDetailed.mockResolvedValue(sourcePayload(seriesThrough(DAY, 100)));

    const ctx = await loadSnapshotContext(DAY, { ensureDayCandles: true });
    expect(mocks.getFullHistoryDetailed).toHaveBeenCalledWith('BOVA11', 'ETF');
    expect(ctx.closeMap.get('BOVA11')).toBe(100);

    // Persistiu a série mesclada (o buraco de 18/08 fechou junto) sem "touch" em
    // lastCheckedAt, que mede a VISITA do timeSeriesWorker.
    const [filter, update] = mocks.historyUpdateOne.mock.calls[0];
    expect(filter).toEqual({ ticker: 'BOVA11' });
    expect(update.$set.history.map((c) => c.date)).toEqual(['2026-08-17', '2026-08-18', DAY]);
    expect(update.$set.history.at(-1)).toMatchObject({ date: DAY, close: 100 });
    expect(update.$set.lastCheckedAt).toBeUndefined();

    await persistUserSnapshotForDay(WALLET, DAY, ctx);
    expect(mocks.upsertSnapshot.mock.calls.at(-1)[3].totalEquity).toBeCloseTo(1000, 2); // 10 × 100 (não 992)
  });

  it('(b) falha na busca não derruba o snapshot: o preço corrente volta a ser o fallback', async () => {
    wireUserAssets([HELD_ETF]);
    mocks.historyAggregate.mockResolvedValue([]);
    mocks.getMarketDataMap.mockResolvedValue(new Map([['BOVA11', { price: 99.2 }]]));
    mocks.getFullHistoryDetailed.mockRejectedValue(new Error('Yahoo timeout'));

    const ctx = await loadSnapshotContext(DAY, { ensureDayCandles: true });
    expect(ctx.closeMap.has('BOVA11')).toBe(false);
    expect(mocks.historyUpdateOne).not.toHaveBeenCalled();

    const result = await persistUserSnapshotForDay(WALLET, DAY, ctx);
    expect(result).toBe('created');
    expect(mocks.upsertSnapshot.mock.calls.at(-1)[3].totalEquity).toBeCloseTo(992, 2); // 10 × 99,20
  });

  it('(c) o universo sai de UserAsset: ativo fora de carteira e posição zerada não são buscados', async () => {
    wireUserAssets([HELD_ETF, SOLD_OUT]);
    mocks.historyAggregate.mockResolvedValue([]);
    mocks.getMarketDataMap.mockResolvedValue(new Map([['BOVA11', { price: 99.2 }]]));
    mocks.getFullHistoryDetailed.mockResolvedValue(sourcePayload(seriesThrough(DAY, 100)));

    await loadSnapshotContext(DAY, { ensureDayCandles: true });

    expect(mocks.getFullHistoryDetailed).toHaveBeenCalledTimes(1);
    expect(mocks.getFullHistoryDetailed).toHaveBeenCalledWith('BOVA11', 'ETF');
    // O universo de pesquisa (MarketAsset, ~1.264 ativos) não pode nem ser
    // consultado — é o que mantém o custo do run em algumas dezenas de buscas.
    expect(mocks.marketAssetFind).not.toHaveBeenCalled();
  });

  it('(d) dia publicado VAZIO pela fonte: o log nomeia o ticker e o motivo', async () => {
    // Em 27/08/2026 o Yahoo devolveu a linha do pregão dos ETFs da B3 com
    // close/open/volume nulos: `getFullHistory` a descarta (certo — candle sem
    // preço não é candle), então a série chega SEM o dia e é indistinguível de
    // fonte atrasada. `emptyDates` é o que separa "não vem mais" de "ainda não
    // chegou" — e sem essa distinção o alarme do painel de Saúde do dia seguinte
    // obriga a refazer à mão a ida ao Mongo e à fonte.
    wireUserAssets([HELD_ETF]);
    mocks.historyAggregate.mockResolvedValue([]);
    mocks.getMarketDataMap.mockResolvedValue(new Map([['BOVA11', { price: 99.2 }]]));
    mocks.getFullHistoryDetailed.mockResolvedValue(sourcePayload(
      [{ date: '2026-08-18', close: 99, adjClose: 99, volume: 100 }],
      [DAY],
    ));

    const ctx = await loadSnapshotContext(DAY, { ensureDayCandles: true });
    expect(ctx.closeMap.has('BOVA11')).toBe(false);
    // Candle vazio NÃO pode ser gravado: viraria um buraco que a mescla seguinte
    // trataria como preenchido.
    expect(mocks.historyUpdateOne).not.toHaveBeenCalled();

    const warn = mocks.loggerWarn.mock.calls.find(([msg]) => msg.includes('sem candle do dia'));
    expect(warn).toBeDefined();
    expect(warn[1].assets).toEqual(['BOVA11: dia publicado VAZIO pela fonte (close nulo)']);

    // E o snapshot segue de pé, no preço corrente.
    await persistUserSnapshotForDay(WALLET, DAY, ctx);
    expect(mocks.upsertSnapshot.mock.calls.at(-1)[3].totalEquity).toBeCloseTo(992, 2);
  });

  it('(e) fonte atrasada, fonte muda e erro de busca são motivos distintos', async () => {
    // As três causas pedem ações diferentes: esperar o próximo run, investigar o
    // ticker, ou olhar o breaker. A contagem agregada antiga não separava nenhuma.
    const HELD_FII = { ticker: 'MXRF11', type: 'FII', currency: 'BRL', quantity: 10, totalCost: 100, totalCostBrl: 100 };
    const HELD_STOCK = { ticker: 'PETR4', type: 'STOCK', currency: 'BRL', quantity: 10, totalCost: 400, totalCostBrl: 400 };
    wireUserAssets([HELD_ETF, HELD_FII, HELD_STOCK]);
    mocks.historyAggregate.mockResolvedValue([]);
    mocks.getMarketDataMap.mockResolvedValue(new Map([
      ['BOVA11', { price: 99.2 }], ['MXRF11', { price: 10 }], ['PETR4', { price: 40 }],
    ]));
    mocks.getFullHistoryDetailed.mockImplementation(async (ticker) => {
      if (ticker === 'BOVA11') return sourcePayload([{ date: '2026-08-18', close: 99, adjClose: 99, volume: 1 }]);
      if (ticker === 'MXRF11') return null;
      throw new Error('Yahoo timeout');
    });

    await loadSnapshotContext(DAY, { ensureDayCandles: true });

    const warn = mocks.loggerWarn.mock.calls.find(([msg]) => msg.includes('sem candle do dia'));
    expect(warn[1].missing).toBe(3);
    expect(warn[1].assets.sort()).toEqual([
      'BOVA11: fonte ainda sem o dia (última: 2026-08-18)',
      'MXRF11: sem resposta da fonte',
      'PETR4: erro na busca (Yahoo timeout)',
    ]);
  });

  it('cripto com candle do dia já na série não regride: nada é buscado', async () => {
    wireUserAssets([HELD_CRYPTO]);
    mocks.historyAggregate.mockResolvedValue([{ ticker: 'BTC-USD', candle: { close: 60000 } }]);
    mocks.getMarketDataMap.mockResolvedValue(new Map([['BTC', { price: 59000 }]]));

    const ctx = await loadSnapshotContext(DAY, { ensureDayCandles: true });
    expect(mocks.getFullHistoryDetailed).not.toHaveBeenCalled();
    expect(ctx.closeMap.get('BTC-USD')).toBe(60000);

    await persistUserSnapshotForDay(WALLET, DAY, ctx);
    // 0,01 × 60.000 × 5 (USD/BRL) — fechamento, não a cotação corrente.
    expect(mocks.upsertSnapshot.mock.calls.at(-1)[3].totalEquity).toBeCloseTo(3000, 2);
  });

  it('o backfill/boot não paga buscas externas: só quem grava o dia liga a garantia', async () => {
    wireUserAssets([HELD_ETF]);
    mocks.historyAggregate.mockResolvedValue([]);
    mocks.getMarketDataMap.mockResolvedValue(new Map([['BOVA11', { price: 99.2 }]]));

    await loadSnapshotContext(DAY);

    expect(mocks.getFullHistoryDetailed).not.toHaveBeenCalled();
  });
});
