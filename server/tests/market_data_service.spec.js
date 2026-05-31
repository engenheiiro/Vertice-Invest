/**
 * T4 — marketDataService (cache, blacklist dinâmica, fallback).
 * 100% determinístico: Mongoose e o serviço externo são mockados — sem rede/DB.
 * Foca em refreshQuotesBatch (freshness de cache, skip de inativos, failCount
 * com teto/coerção do B2) e em normalizeSymbol.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarketAsset from '../models/MarketAsset.js';
import { externalMarketService } from '../services/externalMarketService.js';
import { marketDataService } from '../services/marketDataService.js';

vi.mock('../models/MarketAsset.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), bulkWrite: vi.fn() },
}));
vi.mock('../models/AssetHistory.js', () => ({ default: { findOne: vi.fn(), create: vi.fn() } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getQuotes: vi.fn() },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Helper: faz MarketAsset.find(...).select(...) resolver para os docs dados.
const mockFind = (docs) => {
  MarketAsset.find.mockReturnValue({ select: vi.fn().mockResolvedValue(docs) });
};

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeSymbol', () => {
  it('uppercase, trim e remove sufixo .SA', () => {
    expect(marketDataService.normalizeSymbol('petr4.SA')).toBe('PETR4');
    expect(marketDataService.normalizeSymbol('  vale3 ')).toBe('VALE3');
    expect(marketDataService.normalizeSymbol(null)).toBe('');
  });
});

describe('refreshQuotesBatch — cache', () => {
  it('não busca cotação quando o ativo está fresco (cache válido)', async () => {
    mockFind([{ ticker: 'PETR4', updatedAt: minutesAgo(1), lastPrice: 40, isActive: true, failCount: 0 }]);
    await marketDataService.refreshQuotesBatch(['PETR4'], false);
    expect(externalMarketService.getQuotes).not.toHaveBeenCalled();
    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled();
  });

  it('busca e atualiza quando o ativo está stale (> janela de cache)', async () => {
    mockFind([{ ticker: 'PETR4', updatedAt: minutesAgo(60), lastPrice: 40, isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([{ ticker: 'PETR4', price: 42, change: 1.5 }]);

    await marketDataService.refreshQuotesBatch(['PETR4'], false);

    expect(externalMarketService.getQuotes).toHaveBeenCalledWith(['PETR4']);
    const ops = MarketAsset.bulkWrite.mock.calls[0][0];
    const set = ops[0].updateOne.update.$set;
    expect(set.lastPrice).toBe(42);
    expect(set.failCount).toBe(0); // sucesso reseta o contador
    expect(set.isActive).toBe(true);
  });
});

describe('refreshQuotesBatch — blacklist dinâmica', () => {
  it('ignora ativo já desativado (isActive=false) mesmo com force', async () => {
    mockFind([{ ticker: 'XPTO3', updatedAt: minutesAgo(120), lastPrice: 0, isActive: false, failCount: 10 }]);
    await marketDataService.refreshQuotesBatch(['XPTO3'], true);
    expect(externalMarketService.getQuotes).not.toHaveBeenCalled();
    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled();
  });

  it('falha incrementa failCount e desativa ao atingir o teto (10)', async () => {
    mockFind([{ ticker: 'FAIL3', updatedAt: minutesAgo(60), lastPrice: 5, isActive: true, failCount: 9 }]);
    externalMarketService.getQuotes.mockResolvedValue([]); // nenhuma cotação retornada

    await marketDataService.refreshQuotesBatch(['FAIL3'], false);

    const ops = MarketAsset.bulkWrite.mock.calls[0][0];
    const set = ops[0].updateOne.update.$set;
    expect(set.failCount).toBe(10);
    expect(set.isActive).toBe(false); // 9 + 1 = 10 → blacklist
  });

  it('coage failCount corrompido (não-finito) para 0 antes de incrementar [B2]', async () => {
    mockFind([{ ticker: 'BUG3', updatedAt: minutesAgo(60), lastPrice: 5, isActive: true, failCount: 'abc' }]);
    externalMarketService.getQuotes.mockResolvedValue([]);

    await marketDataService.refreshQuotesBatch(['BUG3'], false);

    const ops = MarketAsset.bulkWrite.mock.calls[0][0];
    const set = ops[0].updateOne.update.$set;
    expect(set.failCount).toBe(1); // 'abc' → 0, +1 = 1
    expect(set.isActive).toBeUndefined(); // longe do teto, não desativa
  });
});
