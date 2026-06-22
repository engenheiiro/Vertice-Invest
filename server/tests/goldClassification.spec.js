/**
 * Classificação de Ouro (função pura) — detecção de instrumentos de ouro por ticker.
 */
import { describe, it, expect } from 'vitest';
import { isGoldTicker } from '../utils/goldClassification.js';

describe('isGoldTicker', () => {
  it('reconhece ETFs de ouro dos EUA', () => {
    expect(isGoldTicker('GLD')).toBe(true);
    expect(isGoldTicker('IAU')).toBe(true);
    expect(isGoldTicker('SGOL')).toBe(true);
  });

  it('reconhece o ETF de ouro da B3 (GOLD11)', () => {
    expect(isGoldTicker('GOLD11')).toBe(true);
  });

  it('é case-insensitive e tolera sufixo de bolsa', () => {
    expect(isGoldTicker('gld')).toBe(true);
    expect(isGoldTicker('GOLD11.SA')).toBe(true);
    expect(isGoldTicker('IAU.US')).toBe(true);
  });

  it('não classifica ações/FIIs/cripto comuns como ouro', () => {
    expect(isGoldTicker('PETR4')).toBe(false);
    expect(isGoldTicker('AAPL')).toBe(false);
    expect(isGoldTicker('MXRF11')).toBe(false);
    expect(isGoldTicker('BTC')).toBe(false);
    expect(isGoldTicker('GOOGL')).toBe(false); // contém "GO" mas não é ouro
  });

  it('trata entradas vazias com segurança', () => {
    expect(isGoldTicker('')).toBe(false);
    expect(isGoldTicker(undefined)).toBe(false);
    expect(isGoldTicker(null)).toBe(false);
  });
});
