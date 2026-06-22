import { describe, it, expect } from 'vitest';
import {
  getAssetLogoUrl,
  normalizeTicker,
  getAssetInitials,
  getFallbackTextColor,
  getFixedIncomeLabel,
} from './assetLogo';

describe('normalizeTicker', () => {
  it('coloca em maiúsculo e remove espaços', () => {
    expect(normalizeTicker(' petr4 ')).toBe('PETR4');
    expect(normalizeTicker('tesouro selic')).toBe('TESOUROSELIC');
  });
  it('remove sufixo -USD de cripto', () => {
    expect(normalizeTicker('BTC-USD')).toBe('BTC');
  });
});

describe('getAssetLogoUrl', () => {
  it('aponta para o proxy do backend (type=STOCK) para ações BR', () => {
    expect(getAssetLogoUrl('PETR4', 'STOCK')).toBe(
      '/api/market/logo/PETR4?type=STOCK'
    );
  });
  it('retorna null para FIIs (sem CDN público) → fallback de iniciais', () => {
    expect(getAssetLogoUrl('MXRF11', 'FII')).toBeNull();
  });
  it('aponta para o proxy do backend (type=CRYPTO) para cripto', () => {
    expect(getAssetLogoUrl('BTC', 'CRYPTO')).toBe(
      '/api/market/logo/BTC?type=CRYPTO'
    );
  });
  it('aponta para o proxy do backend (type=STOCK_US) para ações US', () => {
    expect(getAssetLogoUrl('AAPL', 'STOCK_US')).toBe(
      '/api/market/logo/AAPL?type=STOCK_US'
    );
  });
  it('trata tipo desconhecido como ação B3 (type=STOCK)', () => {
    expect(getAssetLogoUrl('PETR4')).toBe('/api/market/logo/PETR4?type=STOCK');
  });
  it('ETF nacional (BRL ou sem moeda) usa a fonte B3 (type=STOCK)', () => {
    expect(getAssetLogoUrl('BOVA11', 'ETF')).toBe('/api/market/logo/BOVA11?type=STOCK');
    expect(getAssetLogoUrl('BOVA11', 'ETF', 'BRL')).toBe('/api/market/logo/BOVA11?type=STOCK');
  });
  it('ETF internacional (USD) usa a fonte US (type=STOCK_US)', () => {
    expect(getAssetLogoUrl('VOO', 'ETF', 'USD')).toBe('/api/market/logo/VOO?type=STOCK_US');
  });
  it('retorna null para renda fixa e caixa', () => {
    expect(getAssetLogoUrl('TESOURO SELIC', 'FIXED_INCOME')).toBeNull();
    expect(getAssetLogoUrl('CAIXA', 'CASH')).toBeNull();
  });
  it('retorna null para ticker vazio', () => {
    expect(getAssetLogoUrl('', 'STOCK')).toBeNull();
  });
});

describe('getFallbackTextColor', () => {
  it('cor por tipo', () => {
    expect(getFallbackTextColor('CRYPTO')).toBe('text-purple-400');
    expect(getFallbackTextColor('STOCK_US')).toBe('text-blue-400');
    expect(getFallbackTextColor('STOCK')).toBe('text-slate-300');
  });
});

describe('getFixedIncomeLabel', () => {
  it('detecta os títulos do Tesouro pelo nome', () => {
    expect(getFixedIncomeLabel('Tesouro Renda+ 2065')).toBe('R+');
    expect(getFixedIncomeLabel('Tesouro Educa+ 2040')).toBe('E+');
    expect(getFixedIncomeLabel('Tesouro Selic 2029')).toBe('SELIC');
    expect(getFixedIncomeLabel('Tesouro IPCA+ 2035')).toBe('IPCA+');
    expect(getFixedIncomeLabel('Tesouro Prefixado 2027')).toBe('PRÉ');
  });
  it('detecta produtos bancários', () => {
    expect(getFixedIncomeLabel('CDB Banco XP 120% CDI')).toBe('CDB');
    expect(getFixedIncomeLabel('LCI Inter')).toBe('LCI');
  });
  it('usa fallback genérico quando não reconhece', () => {
    expect(getFixedIncomeLabel('Tesouro Desconhecido')).toBe('TD');
    expect(getFixedIncomeLabel('Aplicação qualquer')).toBe('RF');
    expect(getFixedIncomeLabel()).toBe('RF');
  });
});

describe('getAssetInitials', () => {
  it('retorna até 2 caracteres', () => {
    expect(getAssetInitials('PETR4')).toBe('PE');
    expect(getAssetInitials('')).toBe('?');
  });
});
