/**
 * Heurística de sub-tipo de Exterior (STOCK_US): STOCK | ETF | REIT | DOLLAR.
 * Função pura — testada isolada, sem subir Mongo/Express.
 */
import { describe, it, expect } from 'vitest';
import { classifyUsAsset, KNOWN_US_ETFS } from '../utils/usClassification.js';

describe('classifyUsAsset', () => {
  it('classifica caixa em USD como DOLLAR', () => {
    expect(classifyUsAsset({ ticker: 'RESERVA-USD', type: 'CASH', currency: 'USD' })).toBe('DOLLAR');
  });

  it('classifica símbolo cambial como DOLLAR', () => {
    expect(classifyUsAsset({ ticker: 'USD' })).toBe('DOLLAR');
    expect(classifyUsAsset({ ticker: 'USDBRL=X' })).toBe('DOLLAR');
  });

  it('classifica ETF conhecido da allowlist', () => {
    expect(classifyUsAsset({ ticker: 'VOO' })).toBe('ETF');
    expect(classifyUsAsset({ ticker: 'QQQ', sector: 'Technology' })).toBe('ETF');
  });

  it('classifica por nome contendo ETF', () => {
    expect(classifyUsAsset({ ticker: 'XYZ', name: 'Some Index ETF' })).toBe('ETF');
  });

  it('classifica REIT por setor imobiliário (Real Estate)', () => {
    expect(classifyUsAsset({ ticker: 'O', sector: 'Real Estate' })).toBe('REIT');
  });

  it('classifica REIT por nome', () => {
    expect(classifyUsAsset({ ticker: 'SPG', name: 'Simon Property Group REIT' })).toBe('REIT');
  });

  it('default é STOCK para ação comum', () => {
    expect(classifyUsAsset({ ticker: 'AAPL', sector: 'Technology' })).toBe('STOCK');
    expect(classifyUsAsset({ ticker: 'NVDA' })).toBe('STOCK');
  });

  it('ETF tem precedência sobre REIT para ETFs imobiliários conhecidos', () => {
    // VNQ está na allowlist de ETFs (mesmo sendo de Real Estate) → ETF, não REIT.
    expect(classifyUsAsset({ ticker: 'VNQ', sector: 'Real Estate' })).toBe('ETF');
  });

  it('OURO (GOLD) tem precedência sobre ETF para instrumentos de ouro', () => {
    // GLD/IAU são instrumentos de ouro → GOLD, não ETF genérico.
    expect(classifyUsAsset({ ticker: 'GLD' })).toBe('GOLD');
    expect(classifyUsAsset({ ticker: 'IAU', sector: 'Commodities' })).toBe('GOLD');
  });

  it('não classifica mineradora de ouro (ação) como GOLD', () => {
    // "Barrick Gold" é ação (ticker não-ouro): permanece STOCK, não GOLD.
    expect(classifyUsAsset({ ticker: 'NEM', name: 'Newmont Corporation Gold Miner' })).toBe('STOCK');
  });

  it('allowlist de ETFs não é vazia', () => {
    expect(KNOWN_US_ETFS.size).toBeGreaterThan(10);
  });
});
