/**
 * T7 — Integração do pipeline de ranking (scoringEngine + portfolioEngine).
 * Replica fielmente o fluxo de aiResearchService.runFullPipeline (sem DB/HTTP):
 *   processAsset → performCompetitiveDraft → applyConcentrationPenalty → sort.
 * Verifica que as engines "conversam" e produzem um ranking coerente, e que as
 * Regras de Negócio Invioláveis valem ponta-a-ponta (threshold 70, ordenação
 * soberana por score, descarte de inelegíveis).
 */
import { describe, it, expect } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';
import { portfolioEngine } from '../services/engines/portfolioEngine.js';

const CONTEXT = { MACRO: { SELIC: 14.75, IPCA: 4.62, RISK_FREE: 14.75, NTNB_LONG: 6.3 } };

const stockMetrics = (o = {}) => ({
  pl: 12, pvp: 1.6, roe: 18, roic: 15, netMargin: 22, evEbitda: 7, revenueGrowth: 12,
  debtToEquity: 0.8, netDebt: 5e8, payout: 55, dy: 8, marketCap: 1.5e10, avgLiquidity: 5e6,
  vacancy: 0, capRate: 0, qtdImoveis: 0, volatility: 26, beta: 0.85, sma200: 38, ema50: 39,
  _missing: { pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false, evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false },
  _staleDays: 20, ...o,
});

const makeStock = (ticker, sector, price, m = {}) => ({
  ticker, type: 'STOCK', name: ticker, sector, fiiSubType: null, price,
  dbFlags: { isBlacklisted: false, isTier1: false },
  metrics: { ...stockMetrics(m), sector, fiiSubType: null },
});

const fiiMetrics = (o = {}) => ({
  pl: 0, pvp: 0.95, roe: 0, netMargin: 0, evEbitda: 0, revenueGrowth: 0, debtToEquity: 0,
  netDebt: 0, payout: 0, dy: 11, marketCap: 2e9, avgLiquidity: 4e6, vacancy: 5, capRate: 9,
  qtdImoveis: 25, volatility: 12, beta: 0.5, sma200: 0, ema50: 0,
  _missing: { roe: true, netMargin: true, revenueGrowth: true, payout: true }, _staleDays: 15, ...o,
});

const makeFii = (ticker, sector, price, fiiSubType, m = {}) => ({
  ticker, type: 'FII', name: ticker, sector, fiiSubType, price,
  dbFlags: { isBlacklisted: false, isTier1: false },
  metrics: { ...fiiMetrics(m), sector, fiiSubType },
});

// Replica o encadeamento real do aiResearchService.
const runPipeline = (rawData) => {
  const processed = [];
  const discarded = [];
  rawData.forEach((asset) => {
    const r = scoringEngine.processAsset(asset, CONTEXT);
    if (r?._discarded) discarded.push({ ticker: asset.ticker, reason: r.reason });
    else if (r) processed.push(r);
  });

  let ranking = portfolioEngine.performCompetitiveDraft(processed);
  ranking = portfolioEngine.applyConcentrationPenalty(ranking);
  ranking.sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    const comp = (x) => (x.metrics?.structural ? (x.metrics.structural.quality + x.metrics.structural.valuation + x.metrics.structural.risk) / 3 : 0);
    return comp(b) - comp(a);
  });
  return { ranking, discarded };
};

const RAW = [
  makeStock('ELET3', 'Energia Elétrica', 40), // elite defensiva
  makeStock('SBSP3', 'Saneamento', 80, { dy: 7, roe: 16 }),
  makeStock('WEAK3', 'Tecnologia', 8, { marketCap: 8e8, beta: 1.6, roe: 4, dy: 1, payout: 0, revenueGrowth: 3 }), // fraca
  makeFii('HGLG11', 'Logística', 160, 'TIJOLO'),
  makeFii('KNCR11', 'Papel / Recebíveis', 100, 'PAPEL', { pvp: 1.0, dy: 12, beta: 0.3 }),
  { ticker: 'USDT', type: 'CRYPTO', name: 'Tether', price: 1, sector: 'Crypto', metrics: { avgLiquidity: 1e9 } }, // stablecoin → descarte
  makeStock('PENNY3', 'Outros', 0.005), // preço de centavos → descarte
];

describe('T7 — pipeline scoring→portfolio produz ranking coerente', () => {
  const { ranking, discarded } = runPipeline(RAW);

  it('descarta inelegíveis (stablecoin e penny) — não entram no ranking', () => {
    const tickers = ranking.map((r) => r.ticker);
    expect(tickers).not.toContain('USDT');
    expect(tickers).not.toContain('PENNY3');
    expect(discarded.map((d) => d.ticker).sort()).toEqual(['PENNY3', 'USDT']);
  });

  it('todo item do ranking tem perfil, score numérico e ação válida', () => {
    expect(ranking.length).toBeGreaterThan(0);
    for (const item of ranking) {
      expect(['DEFENSIVE', 'MODERATE', 'BOLD']).toContain(item.riskProfile);
      expect(typeof item.score).toBe('number');
      expect(['BUY', 'WAIT']).toContain(item.action);
    }
  });

  it('ordenação soberana: ranking decrescente por score', () => {
    for (let i = 1; i < ranking.length; i++) {
      expect(ranking[i - 1].score).toBeGreaterThanOrEqual(ranking[i].score);
    }
  });

  it('Regra #1: action=BUY ⇔ score ≥ 70; WAIT ⇔ score < 70', () => {
    for (const item of ranking) {
      if (item.action === 'BUY') expect(item.score).toBeGreaterThanOrEqual(70);
      else expect(item.score).toBeLessThan(70);
    }
  });

  it('um ativo elite (ELET3) é classificado e recomendado COMPRAR', () => {
    const elet = ranking.find((r) => r.ticker === 'ELET3');
    expect(elet).toBeTruthy();
    expect(elet.action).toBe('BUY');
  });
});
