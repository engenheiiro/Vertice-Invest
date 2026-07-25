import { describe, it, expect } from 'vitest';
import { getAssetSubtitle, getAssetTags } from './assetDisplay';

describe('getAssetSubtitle', () => {
  it('mostra sempre o setor, ignorando o nome real', () => {
    expect(
      getAssetSubtitle({ ticker: 'BTC', name: 'Bitcoin', sector: 'Criptomoeda', type: 'CRYPTO' })
    ).toBe('Criptoativo'); // Criptomoeda → traduzido p/ Criptoativo
    expect(
      getAssetSubtitle({ ticker: 'PETR3', name: 'Petrobras', sector: 'Petróleo', type: 'STOCK' })
    ).toBe('Petróleo');
  });

  it('traduz setores em inglês de ações US', () => {
    expect(
      getAssetSubtitle({ ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology', type: 'STOCK_US' })
    ).toBe('Tecnologia');
  });

  it('usa o setor mesmo quando há nome real (sublinha uniforme)', () => {
    expect(
      getAssetSubtitle({ ticker: 'PETR4', name: 'petr4', sector: 'Energia', type: 'STOCK' })
    ).toBe('Energia');
  });

  it('cai no setor quando não há nome', () => {
    expect(
      getAssetSubtitle({ ticker: 'KLBN4', sector: 'Papel e Celulose', type: 'STOCK' })
    ).toBe('Papel e Celulose');
  });

  it('usa fallback de setor por ticker quando o backend não traz setor (KLBN4)', () => {
    expect(
      getAssetSubtitle({ ticker: 'KLBN4', name: 'KLBN4', sector: 'Outros', type: 'STOCK' })
    ).toBe('Papel e Celulose');
  });

  it('fallback por ticker cobre units (KLBN11) e outras bases (SUZB3)', () => {
    expect(getAssetSubtitle({ ticker: 'KLBN11', type: 'STOCK' })).toBe('Papel e Celulose');
    expect(getAssetSubtitle({ ticker: 'SUZB3', type: 'STOCK' })).toBe('Papel e Celulose');
    expect(getAssetSubtitle({ ticker: 'TAEE11', type: 'STOCK' })).toBe('Energia Elétrica');
  });

  it('ação não mapeada e sem setor cai no rótulo do tipo', () => {
    expect(
      getAssetSubtitle({ ticker: 'XPTO3', name: 'XPTO3', sector: 'Outros', type: 'STOCK' })
    ).toBe('Ação');
  });

  it('renda fixa com nome longo = ticker → "Renda Fixa"', () => {
    expect(
      getAssetSubtitle({
        ticker: 'TESOURO RENDA+ 2045',
        name: 'TESOURO RENDA+ 2045',
        type: 'FIXED_INCOME',
      })
    ).toBe('Renda Fixa');
  });

  it('caixa/reserva → "Caixa / Reserva"', () => {
    expect(
      getAssetSubtitle({ ticker: 'RESERVA', name: 'RESERVA', type: 'CASH' })
    ).toBe('Caixa / Reserva');
  });

  it('fallback final quando não há nada útil', () => {
    expect(getAssetSubtitle({ ticker: 'ZZZ9' })).toBe('Ativo');
  });

  it('sector "ETF" é genérico: sublinha descreve o veículo, sem repetir o selo', () => {
    // ETF internacional amplo (VOO chega do universo curado com sector = 'ETF').
    expect(
      getAssetSubtitle({ ticker: 'VOO', name: 'Vanguard S&P 500 ETF', sector: 'ETF', type: 'STOCK_US', usSubType: 'ETF' })
    ).toBe('Fundo de Índice');
    // ETF internacional setorial mantém o setor real traduzido.
    expect(
      getAssetSubtitle({ ticker: 'VGT', sector: 'Technology', type: 'STOCK_US', usSubType: 'ETF' })
    ).toBe('Tecnologia');
    // ETF nacional sem setor não vira "ETF" na sublinha.
    expect(getAssetSubtitle({ ticker: 'BOVA11', sector: 'ETF', type: 'ETF' })).toBe('Fundo de Índice');
  });

  it('Exterior sem setor útil usa o sub-tipo na sublinha', () => {
    expect(getAssetSubtitle({ ticker: 'O', type: 'STOCK_US', usSubType: 'REIT' })).toBe('Imobiliário (REIT)');
    expect(getAssetSubtitle({ ticker: 'GLD', type: 'STOCK_US', usSubType: 'GOLD' })).toBe('Ouro');
    expect(getAssetSubtitle({ ticker: 'AAPL', type: 'STOCK_US' })).toBe('Ação (EUA)');
  });
});

describe('getAssetTags', () => {
  it('ETF nacional e ETF internacional recebem o MESMO selo', () => {
    const br = getAssetTags({ ticker: 'BOVA11', type: 'ETF' });
    const us = getAssetTags({ ticker: 'VOO', type: 'STOCK_US', usSubType: 'ETF' });
    expect(br.map((t) => t.label)).toEqual(['ETF']);
    expect(us.map((t) => t.label)).toEqual(['ETF']);
    expect(us[0].tone).toBe(br[0].tone);
  });

  it('sub-tipos do Exterior viram selo próprio; ação individual não tem selo', () => {
    expect(getAssetTags({ ticker: 'O', type: 'STOCK_US', usSubType: 'REIT' })[0].label).toBe('REIT');
    expect(getAssetTags({ ticker: 'GLD', type: 'STOCK_US', usSubType: 'GOLD' })[0].label).toBe('Ouro');
    expect(getAssetTags({ ticker: 'AAPL', type: 'STOCK_US', usSubType: 'STOCK' })).toEqual([]);
    expect(getAssetTags({ ticker: 'PETR4', type: 'STOCK' })).toEqual([]);
  });

  it('renda fixa vencida ganha o selo de estado', () => {
    const tags = getAssetTags({ ticker: 'TESOURO IPCA+ 2029', type: 'FIXED_INCOME', matured: true });
    expect(tags.map((t) => t.label)).toEqual(['Vencido']);
  });
});
