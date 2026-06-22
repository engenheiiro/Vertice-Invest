/**
 * PR11 — Densificar rankings não-BR (REIT · STOCK_US · Cripto).
 *
 * Cobre as recalibrações conservadoras e o relax do cap de cripto:
 *  - REIT: faixa de yield 4–5% (+18) tira o cluster de 69 para COMPRAR; REIT fraco fica.
 *  - STOCK_US: bônus de qualidade US escopado (NÃO afeta o BR `STOCK`).
 *  - portfolioEngine.relaxCryptoCap: ranking dedicado de cripto enche MOD/BOLD; sem a flag,
 *    o cap (~3) é preservado (carteiras mistas / Brasil 10).
 * Premissa inviolável: threshold 70.
 */
import { describe, it, expect } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';
import { portfolioEngine } from '../services/engines/portfolioEngine.js';

const CTX = { MACRO: { SELIC: 10.5, IPCA: 4.0, RISK_FREE: 10.5, NTNB_LONG: 6.4 } };

// REIT do Exterior (STOCK_US/usSubType REIT), líquido, sem métricas de empresa.
// NB: separa overrides.metrics do resto p/ o spread NÃO clobberar o objeto metrics inteiro.
const makeReit = ({ metrics: mOver = {}, ...rest } = {}) => ({
  ticker: 'REIT', type: 'STOCK_US', name: 'REIT Teste', sector: 'Real Estate', usSubType: 'REIT',
  fiiSubType: null, price: 100, dbFlags: { isBlacklisted: false, isTier1: false },
  metrics: {
    ticker: 'REIT', price: 100, pl: 0, pvp: 0, roe: 0, roic: 0, netMargin: 0, evEbitda: 0,
    revenueGrowth: 0, debtToEquity: 0.8, netDebt: 0, payout: 0,
    dy: 4.2, marketCap: 0, avgLiquidity: 25000000, vacancy: 0, capRate: 0, qtdImoveis: 0,
    volatility: 15, beta: 1.0, sma200: 95, ema50: 97, sector: 'Real Estate', fiiSubType: null,
    _missing: { pl: true, marketCap: true, roe: true, netMargin: true, revenueGrowth: true, evEbitda: true, beta: false, dy: false, debtToEquity: false, payout: false },
    _staleDays: 10, dataCompleteness: 20, structural: { quality: 50, valuation: 50, risk: 50 },
    ...mOver,
  },
  ...rest,
});

// Ação (STOCK ou STOCK_US) defensivamente elegível, com fundamentos de qualidade.
const makeStock = (type, { metrics: mOver = {}, ...rest } = {}) => ({
  ticker: type === 'STOCK_US' ? 'USQ' : 'BRQ3', type, name: 'Ação Qualidade', sector: type === 'STOCK_US' ? 'Consumer Defensive' : 'Bancos',
  usSubType: type === 'STOCK_US' ? 'STOCK' : null, fiiSubType: null, price: 100,
  dbFlags: { isBlacklisted: false, isTier1: false },
  metrics: {
    ticker: 'Q', price: 100, pl: 15, pvp: 2, roe: 15, roic: 12, netMargin: 12, evEbitda: 8,
    revenueGrowth: 6, debtToEquity: 0.5, netDebt: 0, payout: 0,
    dy: 3.5, marketCap: 50e9, avgLiquidity: 300000000,
    vacancy: 0, capRate: 0, qtdImoveis: 0, volatility: 18, beta: 0.9, sma200: 95, ema50: 97,
    sector: type === 'STOCK_US' ? 'Consumer Defensive' : 'Bancos', fiiSubType: null,
    _missing: { pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false, evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false },
    _staleDays: 10, dataCompleteness: 100, structural: { quality: 50, valuation: 50, risk: 50 },
    ...mOver,
  },
  ...rest,
});

const hasFactor = (res, substr) => res.auditLog.some(a => (a.factor || '').includes(substr));

describe('PR11 — REIT: faixa de yield 4–5%', () => {
  it('REIT com dy ~4% (liquidez ok, D/E<1) cruza 70 no Defensivo', () => {
    const res = scoringEngine.processAsset(makeReit({ metrics: { dy: 4.2 } }), CTX);
    expect(res._discarded).toBeFalsy();
    expect(res.scores.DEFENSIVE).toBeGreaterThanOrEqual(70);
    expect(hasFactor(res, 'Yield Forte')).toBe(true);
  });

  it('REIT com dy 3.6% (abaixo da faixa) NÃO cruza 70 (segue seletivo)', () => {
    const res = scoringEngine.processAsset(makeReit({ metrics: { dy: 3.6 } }), CTX);
    expect(res.scores.DEFENSIVE).toBeLessThan(70);
  });

  it('REIT blue-chip (liquidez >200M + D/E≤1.5) ganha bônus de qualidade', () => {
    const res = scoringEngine.processAsset(makeReit({ metrics: { dy: 5.0, avgLiquidity: 350000000, debtToEquity: 1.0 } }), CTX);
    expect(hasFactor(res, 'Blue-chip')).toBe(true);
  });
});

describe('PR11 — STOCK_US: bônus de qualidade escopado', () => {
  it('STOCK_US de qualidade (dy>3, ROE>12, margem>10) recebe o bônus US', () => {
    const res = scoringEngine.processAsset(makeStock('STOCK_US'), CTX);
    expect(hasFactor(res, 'Qualidade US')).toBe(true);
  });

  it('BR STOCK com as MESMAS métricas NÃO recebe o bônus US (não contamina o BR)', () => {
    const res = scoringEngine.processAsset(makeStock('STOCK'), CTX);
    expect(hasFactor(res, 'Qualidade US')).toBe(false);
  });
});

describe('PR11+ — Teto especulativo do Exterior (STOCK_US sem lucro)', () => {
  // Tese de crescimento SEM lucro (biotech-like): margem/ROE negativos, hyper-growth.
  // pvp/dy zerados forçam o caminho Lynch (PEG reverso) → upside real, BOLD bruto > 82,
  // espelhando o que ARQT/TARS produziam em produção (antes do teto).
  const spec = (type, mOver = {}) => makeStock(type, {
    metrics: { netMargin: -9, roe: -14, revenueGrowth: 45, pl: 10, pvp: 0, dy: 0, volatility: 18, ...mOver },
  });

  it('STOCK_US sem lucro tem o Arrojado limitado pelo teto (≤ 82) e registra o fator', () => {
    const res = scoringEngine.processAsset(spec('STOCK_US'), CTX);
    expect(res._discarded).toBeFalsy();
    expect(res.scores.BOLD).toBeLessThanOrEqual(82);
    expect(hasFactor(res, 'Teto Especulativo US')).toBe(true);
  });

  it('STOCK_US LUCRATIVO (margem +66%) NÃO é limitado e supera o sem-lucro', () => {
    const lucr = scoringEngine.processAsset(spec('STOCK_US', { netMargin: 66, roe: 112 }), CTX);
    const semLucro = scoringEngine.processAsset(spec('STOCK_US'), CTX);
    expect(hasFactor(lucr, 'Teto Especulativo US')).toBe(false);
    expect(lucr.scores.BOLD).toBeGreaterThan(semLucro.scores.BOLD);
  });

  it('BR STOCK sem lucro NÃO sofre o teto US (escopo estrito, não contamina o BR)', () => {
    const res = scoringEngine.processAsset(spec('STOCK'), CTX);
    expect(hasFactor(res, 'Teto Especulativo US')).toBe(false);
  });
});

describe('PR11 — Cripto: relaxCryptoCap no ranking dedicado', () => {
  const makeCrypto = (t) => ({
    ticker: t, type: 'CRYPTO', sector: 'Cripto',
    scores: { DEFENSIVE: 0, MODERATE: 0, BOLD: 60 },
    metrics: { structural: { quality: 50, valuation: 50, risk: 50 } },
  });
  const cryptos = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOT', 'TRX', 'XLM', 'ICP'].map(makeCrypto);

  it('SEM a flag, o cap de cripto por perfil (~3) é preservado', () => {
    const bold = portfolioEngine.performCompetitiveDraft(cryptos).filter(r => r.riskProfile === 'BOLD');
    expect(bold.length).toBe(3);
  });

  it('COM relaxCryptoCap, o Arrojado enche até o alvo do perfil (10)', () => {
    const bold = portfolioEngine
      .performCompetitiveDraft(cryptos, { relaxCryptoCap: true })
      .filter(r => r.riskProfile === 'BOLD');
    expect(bold.length).toBe(10);
  });
});
