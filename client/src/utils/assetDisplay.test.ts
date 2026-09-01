import { describe, it, expect } from 'vitest';
import { getAssetSectorParent, getAssetSubtitle, getAssetTags } from './assetDisplay';

describe('getAssetSubtitle', () => {
  it('mostra sempre o setor, ignorando o nome real', () => {
    expect(
      getAssetSubtitle({ ticker: 'BTC', name: 'Bitcoin', sector: 'Criptomoeda', type: 'CRYPTO' })
    ).toBe('Criptoativo'); // Criptomoeda → traduzido p/ Criptoativo
    expect(
      getAssetSubtitle({ ticker: 'PETR3', name: 'Petrobras', sector: 'Petróleo', type: 'STOCK' })
    ).toBe('Petróleo e Gás'); // canonizado pela MESMA régua do donut (subsetor)
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

  it('ação sem setor reconhecível diz o mesmo que o donut: "Não classificado"', () => {
    // "Ação" seria mais bonito e MENTIROSO em relação à fatia cinza ao lado, que
    // conta essa mesma posição como não classificada.
    expect(
      getAssetSubtitle({ ticker: 'XPTO3', name: 'XPTO3', sector: 'Outros', type: 'STOCK' })
    ).toBe('Não classificado');
  });

  it('renda fixa mostra o INDEXADOR — mesma régua do donut e das sub-metas', () => {
    // Sem índice explícito, a convenção do accrual manda (rate ausente = %CDI → pós).
    expect(
      getAssetSubtitle({
        ticker: 'TESOURO RENDA+ 2045',
        name: 'TESOURO RENDA+ 2045',
        type: 'FIXED_INCOME',
      })
    ).toBe('Pós-fixado');
    expect(
      getAssetSubtitle({ ticker: 'TESOURO IPCA+ 2035', type: 'FIXED_INCOME', fixedIncomeIndex: 'IPCA' })
    ).toBe('IPCA');
    // Reserva vive no balde Caixa, que não tem donut: segue no rótulo do tipo.
    expect(
      getAssetSubtitle({ ticker: 'TESOURO SELIC 2029', type: 'FIXED_INCOME', isReserve: true })
    ).toBe('Renda Fixa');
  });

  it('FII: a sublinha é LITERALMENTE o rótulo da fatia (o donut já é fino)', () => {
    expect(getAssetSubtitle({ ticker: 'KNCR11', sector: 'Títulos e Val. Mob.', type: 'FII' })).toBe('Papel (CRI)');
    expect(getAssetSubtitle({ ticker: 'HGLG11', sector: 'Imóveis Industriais e Logísticos', type: 'FII' })).toBe('Logística');
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

  it('setor da linha que o donut não conhece não existe: o fallback é o MESMO', () => {
    // Antes, a linha adivinhava o setor pelo ticker e a agregação não recebia esse
    // palpite — "Bancos" na linha, "Não classificado" na fatia, mesmo ativo.
    expect(getAssetSubtitle({ ticker: 'MULT3', sector: 'Outros', type: 'STOCK' })).toBe('Shoppings');
    expect(getAssetSectorParent({ ticker: 'MULT3', sector: 'Outros', type: 'STOCK' })).toBe('Imobiliário');
  });

  it('Exterior sem setor útil usa o sub-tipo na sublinha', () => {
    expect(getAssetSubtitle({ ticker: 'O', type: 'STOCK_US', usSubType: 'REIT' })).toBe('Imobiliário (REIT)');
    expect(getAssetSubtitle({ ticker: 'GLD', type: 'STOCK_US', usSubType: 'GOLD' })).toBe('Ouro');
    expect(getAssetSubtitle({ ticker: 'AAPL', type: 'STOCK_US' })).toBe('Ação (EUA)');
  });
});

describe('getAssetSectorParent', () => {
  it('ação: devolve o balde do donut, que é mais largo que a sublinha', () => {
    expect(getAssetSectorParent({ ticker: 'PETR4', sector: 'Petróleo', type: 'STOCK' })).toBe('Commodities');
    expect(getAssetSectorParent({ ticker: 'CMIG4', sector: 'Elétricas', type: 'STOCK' })).toBe('Utilidade Pública');
  });

  it('ETF: a sublinha descreve o índice, o balde do donut vem no title', () => {
    expect(getAssetSectorParent({ ticker: 'BOVA11', sector: 'Índice Amplo', type: 'ETF' })).toBe('ETFs / Índices');
  });

  it('null quando o title só repetiria a sublinha ou a classe não tem donut', () => {
    expect(getAssetSectorParent({ ticker: 'KNCR11', sector: 'Títulos e Val. Mob.', type: 'FII' })).toBeNull();
    expect(getAssetSectorParent({ ticker: 'TESOURO IPCA+ 2035', type: 'FIXED_INCOME', fixedIncomeIndex: 'IPCA' })).toBeNull();
    expect(getAssetSectorParent({ ticker: 'AAPL', sector: 'Technology', type: 'STOCK_US' })).toBeNull();
    expect(getAssetSectorParent({ ticker: 'BTC', sector: 'Criptomoeda', type: 'CRYPTO' })).toBeNull();
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

  it('ETF local com exposição internacional explica que conta em Exterior', () => {
    const [tag] = getAssetTags({ ticker: 'IVVB11', type: 'ETF', allocationClass: 'STOCK_US' });
    expect(tag.label).toBe('ETF');
    expect(tag.title).toContain('Exterior');
    expect(tag.title).toContain('B3');
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

  it('renda fixa diz como foi precificada — mercado ou curva', () => {
    expect(
      getAssetTags({ ticker: 'TESOURO IPCA+ 2035', type: 'FIXED_INCOME', pricingSource: 'MTM' }).map((t) => t.label)
    ).toEqual(['Mercado']);
    expect(
      getAssetTags({ ticker: 'CDB', type: 'FIXED_INCOME', pricingSource: 'ACCRUAL' }).map((t) => t.label)
    ).toEqual(['Na curva']);
  });

  it('vencido acumula com o selo de precificação, nessa ordem', () => {
    const tags = getAssetTags({ ticker: 'TESOURO IPCA+ 2026', type: 'FIXED_INCOME', pricingSource: 'MTM', matured: true });
    expect(tags.map((t) => t.label)).toEqual(['Mercado', 'Vencido']);
  });

  it('reserva/caixa não recebe selo de precificação (é evidentemente na curva)', () => {
    expect(getAssetTags({ ticker: 'RESERVA', type: 'CASH', pricingSource: 'ACCRUAL' })).toEqual([]);
  });
});
