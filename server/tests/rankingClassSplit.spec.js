/**
 * PR10 — Rankings independentes (Exterior · REITs · ETFs).
 *
 * Cobre:
 *  - getMarketData: o universo de cada classe é segregado por type/usSubType
 *    (STOCK_US puro, REIT isolado, ETF unindo BR + internacional + ouro).
 *  - portfolioEngine.relaxSectorConcentration: rankings mono-setor (REIT) não se
 *    auto-penalizam nem colapsam no cap por balde.
 *  - A concatenação de DOIS drafts independentes (espelho da lógica de
 *    calculateRanking('ETF')) preserva ambas as origens com seus próprios picks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarketAsset from '../models/MarketAsset.js';
import { marketDataService } from '../services/marketDataService.js';
import { portfolioEngine } from '../services/engines/portfolioEngine.js';

vi.mock('../models/MarketAsset.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), bulkWrite: vi.fn() },
}));
vi.mock('../models/AssetHistory.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), create: vi.fn() } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

// getMarketData faz `await MarketAsset.find({...})` direto (sem .select()).
const filterOf = (assetClass) => {
  MarketAsset.find.mockResolvedValue([]);
  return marketDataService.getMarketData(assetClass).then(() => MarketAsset.find.mock.calls[0][0]);
};

describe('getMarketData — segregação por classe', () => {
  it('STOCK_US (Exterior) traz só ações puras (exclui REIT/ETF/GOLD/DOLLAR)', async () => {
    const f = await filterOf('STOCK_US');
    expect(f.type).toBe('STOCK_US');
    expect(f.usSubType).toEqual({ $nin: ['REIT', 'ETF', 'GOLD', 'DOLLAR'] });
  });

  it('REIT é classe própria: só STOCK_US/usSubType REIT', async () => {
    const f = await filterOf('REIT');
    expect(f).toMatchObject({ type: 'STOCK_US', usSubType: 'REIT' });
  });

  it('ETF une BR (type ETF) + internacional/ouro (STOCK_US usSubType ETF/GOLD)', async () => {
    const f = await filterOf('ETF');
    expect(f.$or).toEqual([
      { type: 'ETF' },
      { type: 'STOCK_US', usSubType: { $in: ['ETF', 'GOLD'] } },
    ]);
  });

  it('mantém os flags de elegibilidade (isActive/isIgnored/isBlacklisted)', async () => {
    const f = await filterOf('STOCK_US');
    expect(f).toMatchObject({ isIgnored: false, isBlacklisted: false, isActive: true });
  });
});

// ---------------------------------------------------------------------------

const makeReitScored = (ticker, score) => ({
  ticker, type: 'STOCK_US', usSubType: 'REIT', sector: 'Real Estate',
  score, riskProfile: 'DEFENSIVE', thesis: 'Top Pick',
  scores: { DEFENSIVE: score, MODERATE: 0, BOLD: 0 },
  metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
});

describe('portfolioEngine.relaxSectorConcentration (rankings mono-setor)', () => {
  it('SEM relax, REITs (todos REAL_ESTATE) colapsam no cap de 3 no DEFENSIVE', () => {
    const reits = ['O', 'PLD', 'AMT', 'SPG', 'EQIX'].map((t, i) => makeReitScored(t, 80 - i));
    const def = portfolioEngine.performCompetitiveDraft(reits).filter(r => r.riskProfile === 'DEFENSIVE');
    expect(def.length).toBe(3);
  });

  it('COM relax, todos os REITs entram (competem só por score)', () => {
    const reits = ['O', 'PLD', 'AMT', 'SPG', 'EQIX'].map((t, i) => makeReitScored(t, 80 - i));
    const def = portfolioEngine
      .performCompetitiveDraft(reits, { relaxSectorConcentration: true })
      .filter(r => r.riskProfile === 'DEFENSIVE');
    expect(def.length).toBe(5);
  });

  it('penalidade setorial é desligada quando relaxSectorConcentration', () => {
    const portfolio = ['O', 'PLD', 'AMT', 'SPG'].map((t) => makeReitScored(t, 80));
    const relaxed = portfolioEngine.applyConcentrationPenalty(portfolio, { relaxSectorConcentration: true });
    expect(relaxed.every(a => a.score === 80)).toBe(true);
    // sem a opção, o 3º/4º do mesmo balde seriam penalizados (-5/-15)
    const def = portfolioEngine.applyConcentrationPenalty(portfolio);
    expect(def[2].score).toBe(75);
    expect(def[3].score).toBe(65);
  });
});

// ---------------------------------------------------------------------------

const etf = (ticker, type, sector, score) => ({
  ticker, type, sector,
  scores: { DEFENSIVE: score, MODERATE: score - 5, BOLD: score - 10 },
  metrics: { structural: { quality: 55, valuation: 55, risk: 55 } },
});

describe('ETF — dois drafts independentes (espelho de calculateRanking)', () => {
  it('concatenar draft BR + draft US preserva ambas as origens com picks próprios', () => {
    // US pontuam mais alto (~71) que os BR (~52): num draft único os BR seriam
    // empurrados; independentes, o BR tem seu próprio top defensivo.
    const us = ['VOO', 'IVV', 'QQQ'].map((t) => etf(t, 'STOCK_US', 'ETF', 71));
    const br = ['BOVA11', 'IVVB11'].map((t) => etf(t, 'ETF', 'Índice Amplo', 52));

    const draft = (assets) => portfolioEngine.applyConcentrationPenalty(portfolioEngine.performCompetitiveDraft(assets));
    const ranking = [...draft(br), ...draft(us)];

    expect(ranking.some(r => r.type === 'ETF')).toBe(true);       // BR presente
    expect(ranking.some(r => r.type === 'STOCK_US')).toBe(true);  // US presente
    const brDefensive = ranking.filter(r => r.type === 'ETF' && r.riskProfile === 'DEFENSIVE');
    expect(brDefensive.length).toBeGreaterThan(0);
  });
});
