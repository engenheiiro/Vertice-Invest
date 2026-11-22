/**
 * Ponto live (KPI do gráfico) × card × snapshot — as mesmas réguas.
 *
 *  - Cota live credita a RENDA do período (proventos com ex-date desde o âncora).
 *    Sem ela, no dia-ex o preço já caiu e a cota afundava até o snapshot das 23:59.
 *  - `calculateLiveKPIS` lê proventos pelo ACCRUAL (ex-date × quantidade da
 *    época), como card/snapshot/rebuild — não por data de pagamento × qtd de hoje.
 *  - Ativo sem cotação é marcado no custo (como rebuild e snapshot), não a zero.
 *  - CDI corrente: CDI → Selic → fallback, uma cadeia só.
 *  - Extrato por ativo: `limit` com teto e `page` ≥ 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('mongoose', () => ({ default: { startSession: vi.fn() } }));
vi.mock('../services/errorLogService.js', () => ({ recordError: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../models/User.js', () => ({ default: {} }));
vi.mock('../models/Wallet.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: { find: vi.fn(), findOne: vi.fn() } }));
vi.mock('../models/AssetTransaction.js', () => ({ default: { find: vi.fn(), countDocuments: vi.fn() } }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/TreasuryBond.js', () => ({ default: {} }));
vi.mock('../services/treasuryPriceService.js', () => {
  const empty = { catalog: [], series: new Map(), historyFor: () => null, resolve: () => ({ key: null, reason: 'NOT_TREASURY' }) };
  return { loadTreasuryPricing: vi.fn(async () => empty), EMPTY_TREASURY_PRICING: empty };
});
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: { find: vi.fn(() => ({ lean: () => [] })) } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../services/marketDataService.js', () => ({
  marketDataService: { refreshQuotesBatch: vi.fn(), getMarketDataMap: vi.fn() },
}));
vi.mock('../services/financialService.js', () => ({
  financialService: {
    accrueDividendsByTicker: vi.fn(),
    calculateUserDividends: vi.fn(),
    recalculatePosition: vi.fn(),
    rebuildUserHistory: vi.fn(),
  },
}));
vi.mock('../services/schedulerService.js', () => ({ runDailySnapshot: vi.fn() }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { calculateLiveKPIS, getAssetTransactions, ASSET_TRANSACTIONS_MAX_LIMIT } =
  await import('../controllers/walletController.js');
const { computeLiveQuota, resolveCurrentCdiRate } = await import('../utils/mathUtils.js');
const UserAsset = (await import('../models/UserAsset.js')).default;
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const SystemConfig = (await import('../models/SystemConfig.js')).default;
const { marketDataService } = await import('../services/marketDataService.js');
const { financialService } = await import('../services/financialService.js');

beforeEach(() => vi.clearAllMocks());

describe('computeLiveQuota — renda do período', () => {
  const anchor = { quotaPrice: 110, totalEquity: 1000 };

  it('provento com ex-date desde o âncora compensa a queda do dia-ex', () => {
    // FII a 100 × 10 cotas, fica ex de R$ 1,00: o saldo cai para 990, mas a
    // carteira não perdeu nada — os R$ 10 estão a receber.
    expect(computeLiveQuota(anchor, 990, 0, 10)).toBeCloseTo(110, 8);
    // Sem a renda, a cota live mostrava −1%.
    expect(computeLiveQuota(anchor, 990, 0)).toBeCloseTo(108.9, 8);
  });

  it('renda inválida é ignorada, nunca vira NaN na cota', () => {
    expect(computeLiveQuota(anchor, 1000, 0, NaN)).toBe(110);
    expect(computeLiveQuota(anchor, 1000, 0, undefined)).toBe(110);
  });
});

describe('resolveCurrentCdiRate — CDI → Selic → fallback', () => {
  it('cai na Selic antes do fallback fixo', () => {
    expect(resolveCurrentCdiRate({ cdi: 14.15, selic: 14.25 }, 10)).toBe(14.15);
    expect(resolveCurrentCdiRate({ cdi: 0, selic: 14.25 }, 10)).toBe(14.25);
    expect(resolveCurrentCdiRate({ selic: null }, 10)).toBe(10);
    expect(resolveCurrentCdiRate(null, 10)).toBe(10);
  });
});

describe('calculateLiveKPIS — mesma régua do card e do snapshot', () => {
  beforeEach(() => {
    UserAsset.find.mockResolvedValue([
      { ticker: 'PETR4', type: 'STOCK', currency: 'BRL', quantity: 10, totalCost: 300, totalCostBrl: 300 },
      { ticker: 'XPTO3', type: 'STOCK', currency: 'BRL', quantity: 5, totalCost: 100, totalCostBrl: 100 },
    ]);
    SystemConfig.findOne.mockResolvedValue({ dollar: 5, selic: 14.25 });
    marketDataService.refreshQuotesBatch.mockResolvedValue();
    // XPTO3 sem cotação nenhuma.
    marketDataService.getMarketDataMap.mockResolvedValue(new Map([['PETR4', { price: 32 }]]));
    financialService.accrueDividendsByTicker.mockResolvedValue({ total: 7.5, sinceTotal: 2.5, byTicker: {}, sinceByTicker: {} });
    financialService.calculateUserDividends.mockResolvedValue({ totalAllTime: 999 });
  });

  it('proventos pelo accrual, com o recorte desde o âncora', async () => {
    const live = await calculateLiveKPIS('u1', 14.25, 'w1', { sinceDayKey: '2026-11-20' });

    expect(financialService.calculateUserDividends).not.toHaveBeenCalled();
    expect(financialService.accrueDividendsByTicker).toHaveBeenCalledWith(
      'u1', 'w1', expect.any(String), { sinceDayKey: '2026-11-20' },
    );
    expect(live.totalDividends).toBe(7.5);
    expect(live.dividendsSinceAnchor).toBe(2.5);
  });

  it('sem âncora, não há renda do período', async () => {
    const live = await calculateLiveKPIS('u1', 14.25, 'w1');
    expect(live.dividendsSinceAnchor).toBe(0);
  });

  it('ativo sem cotação entra pelo custo, não a zero', async () => {
    const live = await calculateLiveKPIS('u1', 14.25, 'w1');
    expect(live.totalEquity).toBeCloseTo(10 * 32 + 100, 2);
    expect(live.totalInvested).toBeCloseTo(400, 2);
  });
});

describe('getAssetTransactions — paginação saneada', () => {
  const run = async (query) => {
    const calls = {};
    AssetTransaction.find.mockReturnValue({
      sort: () => ({
        skip: (n) => { calls.skip = n; return { limit: (l) => { calls.limit = l; return Promise.resolve([]); } }; },
      }),
    });
    AssetTransaction.countDocuments.mockResolvedValue(0);
    const res = { json: vi.fn() };
    const next = vi.fn();
    await getAssetTransactions({ params: { ticker: 'petr4' }, query, user: { id: 'u1' }, walletId: 'w1' }, res, next);
    expect(next).not.toHaveBeenCalled();
    return { ...calls, body: res.json.mock.calls[0][0] };
  };

  it('limit acima do teto é cortado', async () => {
    const { limit } = await run({ limit: '1000000' });
    expect(limit).toBe(ASSET_TRANSACTIONS_MAX_LIMIT);
    expect(ASSET_TRANSACTIONS_MAX_LIMIT).toBe(200);
  });

  it('page ≤ 0 ou lixo vira página 1 (sem skip negativo)', async () => {
    for (const page of ['0', '-3', 'abc']) {
      const { skip, body } = await run({ page, limit: '10' });
      expect(skip).toBe(0);
      expect(body.pagination.page).toBe(1);
    }
  });

  it('limit inválido cai no padrão de 10', async () => {
    const { limit, skip } = await run({ page: '3', limit: '0' });
    expect(limit).toBe(10);
    expect(skip).toBe(20);
  });
});
