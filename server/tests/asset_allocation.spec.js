import { describe, expect, it } from 'vitest';
import { allocationBucket, exteriorSubType, resolveAllocationClass } from '../utils/assetAllocation.js';

describe('classe econômica de alocação', () => {
  it('mantém veículo/moeda separados da exposição do IVVB11', () => {
    const asset = { ticker: 'IVVB11', type: 'ETF', currency: 'BRL' };
    expect(resolveAllocationClass(asset)).toBe('STOCK_US');
    expect(allocationBucket(asset)).toBe('STOCK_US');
    expect(exteriorSubType(asset)).toBe('ETF');
    expect(asset.type).toBe('ETF');
    expect(asset.currency).toBe('BRL');
  });

  it('mantém ETF de ações brasileiras em STOCK', () => {
    expect(resolveAllocationClass({ ticker: 'BOVA11', type: 'ETF', currency: 'BRL' })).toBe('STOCK');
  });

  it('usa campo explícito e fallback de setor para ETFs futuros', () => {
    expect(resolveAllocationClass({ ticker: 'NOVO11', type: 'ETF', allocationClass: 'STOCK_US' })).toBe('STOCK_US');
    expect(resolveAllocationClass({ ticker: 'FUTR11', type: 'ETF', sector: 'Exterior (Global)' })).toBe('STOCK_US');
  });

  it('não deixa allocationClass ruim remapear instrumentos que não são ETF', () => {
    expect(resolveAllocationClass({ ticker: 'PETR4', type: 'STOCK', allocationClass: 'STOCK_US' })).toBe('STOCK');
  });

  it('reserva prevalece sobre a classe econômica', () => {
    expect(allocationBucket({ ticker: 'IVVB11', type: 'ETF', isReserve: true })).toBe('CASH');
  });
});
