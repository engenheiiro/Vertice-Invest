/**
 * Proventos — run-rate mensal ("Média Mensal Est.", calculateUserDividends.projectedMonthly).
 *
 * Regressão do defeito de 29/08/2026: a projeção vinha de `MarketAsset.dy × preço ÷ 12`,
 * fonte DIFERENTE do acumulado (`DividendEvent`). Numa carteira real isso projetava
 * R$ 4,53/mês de BOVA11 — ETF de acumulação, ZERO eventos no razão — respondendo por
 * 39% da estimativa exibida ao lado de um acumulado que jamais poderia registrá-la.
 *
 * A regra que estes testes travam: os dois números saem do MESMO razão, então só podem
 * divergir por motivo real (calendário, mudança de posição), nunca por construção.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../models/UserAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/MarketAsset.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../models/DividendEvent.js', () => ({ default: { find: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../models/AssetTransaction.js', () => ({ default: { aggregate: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: { getDividendsHistory: vi.fn() } }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({ default: {} }));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));

const UserAsset = (await import('../models/UserAsset.js')).default;
const MarketAsset = (await import('../models/MarketAsset.js')).default;
const DividendEvent = (await import('../models/DividendEvent.js')).default;
const AssetTransaction = (await import('../models/AssetTransaction.js')).default;
const { financialService } = await import('../services/financialService.js');

const USER = '507f1f77bcf86cd799439011';
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const setupMocks = ({ assets, events = [], market = [], firstBuyDaysAgo = 3650 }) => {
  UserAsset.find.mockResolvedValue(assets);
  MarketAsset.find.mockReturnValue({ select: vi.fn().mockResolvedValue(market) });
  DividendEvent.find.mockReturnValue({ sort: vi.fn().mockResolvedValue(events) });
  AssetTransaction.aggregate.mockResolvedValue(
    assets.map((a) => ({ _id: a.ticker, firstBuyDate: daysAgo(firstBuyDaysAgo) })),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('calculateUserDividends — projectedMonthly', () => {
  it('mede o run-rate no razão: 12 pagamentos de R$1/cota × 10 cotas = R$10/mês', async () => {
    const events = Array.from({ length: 12 }, (_, i) => ({
      ticker: 'HGLG11', date: daysAgo(20 + i * 28), amount: 1, paymentDate: daysAgo(15 + i * 28),
    }));
    setupMocks({
      assets: [{ ticker: 'HGLG11', type: 'FII', quantity: 10, totalCost: 1500 }],
      events,
      market: [{ ticker: 'HGLG11', dy: 8, lastPrice: 150 }],
    });

    const { projectedMonthly } = await financialService.calculateUserDividends(USER);

    expect(projectedMonthly).toBeCloseTo(10, 2);
  });

  it('ETF de acumulação (dy publicado, ZERO eventos) projeta 0 — o defeito do BOVA11', async () => {
    setupMocks({
      assets: [{ ticker: 'BOVA11', type: 'ETF', quantity: 7, totalCost: 1200 }],
      events: [],
      // dy fantasma de 4,5% sobre R$172,72 dava R$ 4,53/mês na fórmula antiga.
      market: [{ ticker: 'BOVA11', dy: 4.5, lastPrice: 172.72 }],
    });

    const { projectedMonthly, totalAllTime } = await financialService.calculateUserDividends(USER);

    expect(projectedMonthly).toBe(0);
    // O ponto do teste: projeção e acumulado concordam porque leem o mesmo razão.
    expect(totalAllTime).toBe(0);
  });

  it('ignora evento fora da janela de 12 meses (run-rate é dos últimos 12m)', async () => {
    setupMocks({
      assets: [{ ticker: 'TAEE11', type: 'STOCK', quantity: 100, totalCost: 3000 }],
      events: [
        { ticker: 'TAEE11', date: daysAgo(400), amount: 5, paymentDate: daysAgo(390) },
        { ticker: 'TAEE11', date: daysAgo(60), amount: 1.2, paymentDate: daysAgo(50) },
      ],
      market: [{ ticker: 'TAEE11', dy: 9, lastPrice: 30 }],
    });

    const { projectedMonthly } = await financialService.calculateUserDividends(USER);

    // Só o de 60 dias entra: 1,2 × 100 ÷ 12 = 10.
    expect(projectedMonthly).toBeCloseTo(10, 2);
  });

  it('deduplica o mesmo provento vindo de duas fontes (mesma ex-date e tipo)', async () => {
    setupMocks({
      assets: [{ ticker: 'KNCR11', type: 'FII', quantity: 12, totalCost: 1200 }],
      events: [
        { ticker: 'KNCR11', date: daysAgo(30), amount: 1.0, paymentDate: daysAgo(20) },
        { ticker: 'KNCR11', date: daysAgo(30), amount: 1.05, paymentDate: daysAgo(20) },
      ],
      market: [{ ticker: 'KNCR11', dy: 12, lastPrice: 100 }],
    });

    const { projectedMonthly } = await financialService.calculateUserDividends(USER);

    // Um único evento contado: 1,0 × 12 ÷ 12 = 1.
    expect(projectedMonthly).toBeCloseTo(1, 2);
  });

  it('cap de 25% a.a. sobre o valor de mercado segura provento extraordinário', async () => {
    setupMocks({
      assets: [{ ticker: 'XPTO3', type: 'STOCK', quantity: 100, totalCost: 1000 }],
      // R$5/cota de uma vez sobre um papel de R$10 = 50% a.a. se tomado como recorrente.
      events: [{ ticker: 'XPTO3', date: daysAgo(30), amount: 5, paymentDate: daysAgo(20) }],
      market: [{ ticker: 'XPTO3', dy: 50, lastPrice: 10 }],
    });

    const { projectedMonthly } = await financialService.calculateUserDividends(USER);

    // Teto: 100 × 10 × 25% ÷ 12 = 20,83 (sem cap seriam 41,67).
    expect(projectedMonthly).toBeCloseTo(20.83, 1);
  });

  it('posição zerada não projeta renda', async () => {
    setupMocks({
      assets: [{ ticker: 'HGLG11', type: 'FII', quantity: 0, totalCost: 0 }],
      events: [{ ticker: 'HGLG11', date: daysAgo(30), amount: 1, paymentDate: daysAgo(20) }],
      market: [{ ticker: 'HGLG11', dy: 8, lastPrice: 150 }],
    });

    const { projectedMonthly } = await financialService.calculateUserDividends(USER);

    expect(projectedMonthly).toBe(0);
  });

  it('sem preço de mercado o cap não zera a projeção (renda vem do razão, não do preço)', async () => {
    setupMocks({
      assets: [{ ticker: 'HGLG11', type: 'FII', quantity: 10, totalCost: 1500 }],
      events: [{ ticker: 'HGLG11', date: daysAgo(30), amount: 1.2, paymentDate: daysAgo(20) }],
      market: [], // ticker ausente no MarketAsset → sem lastPrice
    });

    const { projectedMonthly } = await financialService.calculateUserDividends(USER);

    expect(projectedMonthly).toBeCloseTo(1, 2);
  });
});
