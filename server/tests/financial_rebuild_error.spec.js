/**
 * Regressão: rebuildUserHistory não pode transformar falha em falso sucesso.
 * Os controllers/scripts chamadores já tratam a rejeição em modo best-effort.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../models/AssetTransaction.js', () => ({ default: {} }));
vi.mock('../models/WalletSnapshot.js', () => ({ default: {} }));
vi.mock('../models/UserAsset.js', () => ({ default: {} }));
vi.mock('../models/DividendEvent.js', () => ({ default: {} }));
vi.mock('../models/MarketAsset.js', () => ({ default: {} }));
vi.mock('../models/AssetHistory.js', () => ({ default: {} }));
vi.mock('../models/SystemConfig.js', () => ({ default: {} }));
vi.mock('../models/EconomicIndex.js', () => ({ default: {} }));
vi.mock('../models/AuditLog.js', () => ({
  default: { create: vi.fn() },
}));
vi.mock('../services/marketDataService.js', () => ({ marketDataService: {} }));
vi.mock('../services/externalMarketService.js', () => ({ externalMarketService: {} }));

const AuditLog = (await import('../models/AuditLog.js')).default;
const logger = (await import('../config/logger.js')).default;
const { financialService } = await import('../services/financialService.js');

describe('financialService.rebuildUserHistory — propagação de erro', () => {
  it('rejeita quando uma etapa do rebuild falha e registra o erro fatal', async () => {
    AuditLog.create.mockRejectedValueOnce(new Error('Mongo indisponível'));

    await expect(financialService.rebuildUserHistory('u1', 'w1'))
      .rejects.toThrow('Mongo indisponível');

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Erro Fatal no Rebuild: Mongo indisponível'),
    );
  });
});
