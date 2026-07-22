import { describe, expect, it } from 'vitest';
import { OIL_GAS_SECTOR_METRICS_1Q26 } from '../config/stockOilGasMetricsSnapshot1Q26.js';
import { validateStockSectorMetrics } from '../schemas/stockSectorMetricsSchemas.js';

describe('snapshot OIL_GAS_PRODUCER 1T26', () => {
  it('valida todas as emissoras sem misturar reserva 2P com vida de reserva 1P', () => {
    const rows = Object.values(OIL_GAS_SECTOR_METRICS_1Q26)
      .map(payload => validateStockSectorMetrics(payload));

    expect(rows).toHaveLength(4);
    expect(rows.every(row => row.archetype === 'OIL_GAS_PRODUCER')).toBe(true);
    expect(rows.every(row => row.productionGrowth !== undefined)).toBe(true);
    expect(rows.every(row => row.liftingCostUsdBoe > 0)).toBe(true);
    expect(rows.every(row => row.netDebtEbitda < 3.5)).toBe(true);
    expect(rows.filter(row => row.provedReserveLifeYears !== undefined)
      .every(row => ['SEC_1P', 'SPE_1P'].includes(row.reserveBasis))).toBe(true);
  });
});
