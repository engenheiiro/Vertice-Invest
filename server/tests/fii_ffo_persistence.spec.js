/**
 * Regressão da ingestão de FFO/VP por cota dos FIIs.
 *
 * O scraper do Fundamentus sempre leu "FFO Yield" e derivou `ffoCota`/`vpCota`, mas
 * nenhum dos três existia no schema do MarketAsset nem no update do syncService — o
 * Mongoose os descartava em silêncio e 100% do universo de FIIs chegava ao scoring
 * com `ffoYield = 0`. Consequência: o P/FFO (múltiplo padrão do setor imobiliário)
 * era inutilizável e o preço justo de FII caía sempre no fallback `price / pvp`.
 *
 * Estes testes travam as duas pontas: o campo existe no modelo e, quando presente,
 * o VP persistido é o que alimenta o preço justo.
 */
import { describe, it, expect } from 'vitest';
import MarketAsset from '../models/MarketAsset.js';
import { scoringEngine } from '../services/engines/scoringEngine.js';

const CONTEXT = { MACRO: { SELIC: 14, IPCA: 4.5, RISK_FREE: 14, NTNB_LONG: 8, RATES_STALE: false } };

// FII de tijolo saudável — o que varia entre os casos é apenas o VP por cota.
const fii = (overrides = {}) => ({
  ticker: 'TEST11',
  name: 'FII de Teste',
  type: 'FII',
  sector: 'Logística',
  price: 100,
  dbFlags: { isBlacklisted: false, isTier1: false },
  metrics: {
    dy: 9,
    pvp: 0.8,
    marketCap: 1_000_000_000,
    avgLiquidity: 5_000_000,
    vacancy: 2,
    qtdImoveis: 12,
    beta: 0.5,
    volatility: 12,
    sma200: 95,
    sector: 'Logística',
    _missing: {},
    _staleDays: 0,
    ...overrides,
  },
});

describe('persistência de FFO/VP por cota (FII)', () => {
  it('MarketAsset declara ffoYield, vpCota e ffoCota', () => {
    // Sem estes paths o Mongoose descarta os campos no save, que é exatamente o
    // defeito original: dado raspado corretamente e perdido na gravação.
    expect(MarketAsset.schema.path('ffoYield')).toBeDefined();
    expect(MarketAsset.schema.path('vpCota')).toBeDefined();
    expect(MarketAsset.schema.path('ffoCota')).toBeDefined();
  });

  it('o VP por cota persistido alimenta o preço justo, em vez do fallback price/pvp', () => {
    const semVp = scoringEngine.processAsset(fii(), CONTEXT);
    const comVp = scoringEngine.processAsset(fii({ vpCota: 130 }), CONTEXT);

    // Fallback: vp = price / pvp = 100 / 0,8 = 125 → 125 × (1 + (9 − 8)/100)
    expect(semVp.targetPrice).toBeCloseTo(126.25, 2);
    // Persistido: vp = 130 → 130 × (1 + (9 − 8)/100)
    expect(comVp.targetPrice).toBeCloseTo(131.3, 2);
    expect(comVp.metrics.method).toBe('VP Ajustado');
  });

  it('ffoYield sobrevive ao scoring e fica disponível para o consumidor', () => {
    const comFfo = scoringEngine.processAsset(fii({ ffoYield: 10.4, ffoCota: 10.4 }), CONTEXT);
    expect(comFfo.metrics.ffoYield).toBe(10.4);
  });
});
