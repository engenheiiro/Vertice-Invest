import { describe, it, expect } from 'vitest';
import { getAssetSubtitle } from './assetDisplay';

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
});
