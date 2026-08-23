/**
 * Achado 5a — o caminho LEGADO do `getLatestReport` também zera as saídas por
 * retenção quando o ranking não está publicado.
 *
 * O caminho novo (`composeActiveResearchReport`) amarra as saídas ao documento
 * da seção RANKING, então elas nunca aparecem sem a lista. O legado zerava só
 * `content.ranking` e deixava `retentionExits` passar: o cliente receberia os
 * nomes que "saíram" de uma lista que ele nunca viu — e a ExitList renderiza
 * `report.retentionExits` sem olhar `isRankingPublished`.
 *
 * Mesmo padrão de mocks do research_gating.spec.js: nada de rede nem de banco.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/aiEnhancementService.js', () => ({ aiEnhancementService: {} }));

let legacyDoc = null;
const chain = { select: vi.fn(() => chain), sort: vi.fn(() => Promise.resolve(legacyDoc)) };
vi.mock('../models/MarketAnalysis.js', () => ({ default: { findOne: vi.fn(() => chain) } }));
vi.mock('../models/PublishedResearchPointer.js', () => ({
  default: { find: vi.fn(() => ({ lean: () => Promise.resolve([]) })) },
}));

const { getLatestReport } = await import('../controllers/researchController.js');

const exits = [{
  ticker: 'PSEC11',
  name: 'Pátria Special Credit',
  reason: 'Saiu da lista: não havia vaga no perfil Moderado sem tirar outro ativo que já estava na lista',
  outcome: 'NO_DISPLACEABLE_SEAT',
  score: 85,
  previousScore: 88,
}];

const doc = (isRankingPublished) => ({
  assetClass: 'FII',
  strategy: 'BUY_HOLD',
  isRankingPublished,
  isMorningCallPublished: true,
  content: {
    ranking: [{ position: 1, ticker: 'IRIM11', score: 85, action: 'BUY', riskProfile: 'MODERATE' }],
    morningCall: 'texto',
  },
  retentionExits: exits,
});

const run = async () => {
  const req = { query: { assetClass: 'FII', strategy: 'BUY_HOLD' }, user: { plan: 'PRO', role: 'USER' } };
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await getLatestReport(req, res, (e) => { throw e; });
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('getLatestReport (caminho legado) — saídas seguem a lista', () => {
  it('ranking não publicado: saídas vêm vazias junto com a lista vazia', async () => {
    legacyDoc = doc(false);
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.content.ranking).toEqual([]);
    expect(res.body.retentionExits).toEqual([]);
  });

  it('ranking publicado: as saídas vão junto, com o motivo escrito', async () => {
    legacyDoc = doc(true);
    const res = await run();
    expect(res.body.content.ranking).toHaveLength(1);
    expect(res.body.retentionExits).toEqual(exits);
  });
});
