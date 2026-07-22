import { describe, expect, it } from 'vitest';
import {
  buildBuyAndHoldRanking,
  computeEntryPenalty,
  scoreBuyAndHold,
} from '../services/engines/buyAndHoldEngine.js';

const pssa3 = {
  ticker: 'PSSA3', name: 'Porto Seguro S.A.', sector: 'Seguros', stockArchetype: 'INSURER',
  metrics: { marketCap: 35_577_211_000, beta: 0.73, avgLiquidity: 100_000_000, roe: 23.7, structural: { quality: 80, valuation: 55, risk: 80 } },
  sectorMetrics: { solvencyRatio: 152.06, combinedRatio: 88.7, recurringEarningsGrowth: 15, controlType: 'PRIVATE' },
  currentPrice: 55.14, targetPrice: 40.12,
};

const brav3 = {
  ticker: 'BRAV3', name: 'Brava Energia S.A.', sector: 'Petróleo', stockArchetype: 'OIL_GAS_PRODUCER',
  metrics: { marketCap: 9_128_000_000, beta: 0.80, avgLiquidity: 80_000_000, roe: 2.04, structural: { quality: 0, valuation: 30, risk: 60 } },
  currentPrice: 19.57, targetPrice: 7.37,
};

const abcb4 = {
  ticker: 'ABCB4', name: 'Banco ABC Brasil S.A.', sector: 'Bancos', stockArchetype: 'BANK', isTier1: false,
  metrics: { marketCap: 6_146_927_400, beta: 0.82, avgLiquidity: 17_453_700, roe: 14.08, structural: { quality: 20, valuation: 100, risk: 60 } },
  sectorMetrics: { roeTtm: 22.19, capitalRatio: 15.83, controlType: 'PRIVATE' },
};

// Utility privada forte e com preço justo → deve ser BUY.
const cleanAnchor = {
  ticker: 'GOOD3', name: 'Utility Forte', sector: 'Energia Elétrica', stockArchetype: 'OPERATIONAL',
  metrics: { marketCap: 12_000_000_000, beta: 0.6, avgLiquidity: 40_000_000, roe: 20, revenueGrowth: 12, netDebtEbitda: 1.5, structural: { quality: 85, valuation: 70, risk: 85 } },
  sectorMetrics: { controlType: 'PRIVATE' },
  currentPrice: 34, targetPrice: 38,
};

describe('scoreBuyAndHold — casos de referência', () => {
  it('BRAV3 (petroleira cíclica) é inelegível — nunca aparece', () => {
    const r = scoreBuyAndHold(brav3);
    expect(r.eligible).toBe(false);
    expect(r.action).toBe('WAIT');
  });

  it('ABCB4 (banco não tier-1) é inelegível', () => {
    const r = scoreBuyAndHold(abcb4);
    expect(r.eligible).toBe(false);
  });

  it('PSSA3 é âncora elegível, mas cara → WAIT ("aguarde preço")', () => {
    const r = scoreBuyAndHold(pssa3);
    expect(r.eligible).toBe(true);
    expect(r.entry.expensive).toBe(true);
    expect(r.action).toBe('WAIT');
    expect(r.reason).toMatch(/cara|preço/i);
  });

  it('mesma âncora com preço justo vira BUY', () => {
    const r = scoreBuyAndHold(cleanAnchor);
    expect(r.eligible).toBe(true);
    expect(r.entry.expensive).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.action).toBe('BUY');
  });
});

describe('valuation é freio, nunca bônus', () => {
  it('estar barato não adiciona pontos além do teto de confiança', () => {
    const cheap = { ...cleanAnchor, currentPrice: 10, targetPrice: 40 };
    const fair = { ...cleanAnchor, currentPrice: 34, targetPrice: 38 };
    // Sem streak de dividendo verificado, ambos são limitados pelo mesmo teto (85)
    // e o barato NÃO pontua acima do preço-justo.
    expect(scoreBuyAndHold(cheap).score).toBe(scoreBuyAndHold(fair).score);
  });

  it('preço acima do valor justo gera penalidade e marca expensive', () => {
    const entry = computeEntryPenalty(pssa3);
    expect(entry.expensive).toBe(true);
    expect(entry.penalty).toBeGreaterThan(0);
  });

  it('preço dentro da tolerância não penaliza', () => {
    const entry = computeEntryPenalty({ currentPrice: 39, targetPrice: 38 });
    expect(entry.expensive).toBe(false);
    expect(entry.penalty).toBe(0);
  });
});

describe('governança — controle estatal penaliza resiliência', () => {
  it('estatal ranqueia abaixo de privada de fundamentos idênticos', () => {
    const privateAnchor = { ...cleanAnchor, ticker: 'PRIV3' };
    const stateAnchor = { ...cleanAnchor, ticker: 'CMIG4' }; // consta em STATE_CONTROLLED_TICKERS
    const priv = scoreBuyAndHold(privateAnchor);
    const state = scoreBuyAndHold(stateAnchor);
    expect(state.axes.resilience).toBeLessThan(priv.axes.resilience);
    expect(state.score).toBeLessThanOrEqual(priv.score);
  });
});

describe('consistência através do ciclo', () => {
  it('streak de dividendo verificado libera o teto de confiança para 100', () => {
    const withHistory = {
      ...cleanAnchor,
      consistency: { dividendStreakYears: 8, maxDrawdownPct: 22, roeVolatility: 3 },
    };
    const r = scoreBuyAndHold(withHistory);
    expect(r.dividendVerified).toBe(true);
    expect(r.confidenceCap).toBe(100);
    expect(r.axes.consistency).toBeGreaterThan(0);
  });
});

describe('buildBuyAndHoldRanking', () => {
  it('só lista elegíveis, ordena por score e conta BUY/WAIT', () => {
    const result = buildBuyAndHoldRanking([pssa3, brav3, abcb4, cleanAnchor]);
    const tickers = result.ranking.map(item => item.ticker);
    expect(tickers).toContain('GOOD3');
    expect(tickers).toContain('PSSA3');
    expect(tickers).not.toContain('BRAV3');
    expect(tickers).not.toContain('ABCB4');
    // ordenação soberana por score
    for (let i = 1; i < result.ranking.length; i += 1) {
      expect(result.ranking[i - 1].score).toBeGreaterThanOrEqual(result.ranking[i].score);
    }
    expect(result.counts.eligible).toBe(2);
    expect(result.counts.excluded).toBe(2);
  });
});
