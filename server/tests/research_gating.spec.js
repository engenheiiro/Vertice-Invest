/**
 * F1 — Gate de plano AUTORITATIVO no getLatestReport.
 *
 * Antes, só STOCK_US/REIT eram barrados no backend; STOCK/FII/CRYPTO/ETF ficavam
 * acessíveis a qualquer autenticado (inclusive ESSENTIAL), embora sejam feature
 * Pro+ (research_general). Estes testes travam o comportamento correto por classe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
// aiEnhancementService instancia o cliente Gemini no load (exige API_KEY) — mocka p/ isolar.
vi.mock('../services/aiEnhancementService.js', () => ({ aiEnhancementService: {} }));

// MarketAnalysis.findOne(...).select(...).sort(...) → Promise. Chainable mock.
const reportDoc = { assetClass: 'STOCK', content: { ranking: [] } };
const chain = { select: vi.fn(() => chain), sort: vi.fn(() => Promise.resolve(reportDoc)) };
vi.mock('../models/MarketAnalysis.js', () => ({ default: { findOne: vi.fn(() => chain) } }));
vi.mock('../models/PublishedResearchPointer.js', () => ({
  default: { find: vi.fn(() => ({ lean: () => Promise.resolve([]) })) },
}));

const MarketAnalysis = (await import('../models/MarketAnalysis.js')).default;
const { getLatestReport } = await import('../controllers/researchController.js');

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const run = async (assetClass, plan, role = 'USER') => {
  const req = { query: { assetClass, strategy: 'BUY_HOLD' }, user: { plan, role } };
  const res = mockRes();
  await getLatestReport(req, res, (e) => { throw e; });
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('getLatestReport — gate de plano por classe (F1)', () => {
  it('ESSENTIAL NÃO acessa STOCK/FII/CRYPTO/ETF (research_general → 403)', async () => {
    for (const cls of ['STOCK', 'FII', 'CRYPTO', 'ETF']) {
      const res = await run(cls, 'ESSENTIAL');
      expect(res.statusCode, `classe ${cls}`).toBe(403);
    }
    expect(MarketAnalysis.findOne).not.toHaveBeenCalled(); // barrado antes da query
  });

  it('PRO acessa STOCK/FII/CRYPTO/ETF', async () => {
    for (const cls of ['STOCK', 'FII', 'CRYPTO', 'ETF']) {
      const res = await run(cls, 'PRO');
      expect(res.statusCode, `classe ${cls}`).toBe(200);
    }
  });

  it('PRO NÃO acessa STOCK_US/REIT (research_global exige Elite/Black → 403)', async () => {
    for (const cls of ['STOCK_US', 'REIT']) {
      const res = await run(cls, 'PRO');
      expect(res.statusCode, `classe ${cls}`).toBe(403);
    }
  });

  it('ELITE acessa Ativos Globais (STOCK_US/REIT)', async () => {
    for (const cls of ['STOCK_US', 'REIT']) {
      const res = await run(cls, 'ELITE');
      expect(res.statusCode, `classe ${cls}`).toBe(200);
    }
  });

  it('ADMIN acessa qualquer classe independentemente do plano', async () => {
    const res = await run('STOCK_US', 'GUEST', 'ADMIN');
    expect(res.statusCode).toBe(200);
  });

  it('BRASIL_10 permanece fora do gate (acessível a plano básico)', async () => {
    const res = await run('BRASIL_10', 'ESSENTIAL');
    expect(res.statusCode).toBe(200);
  });
});
