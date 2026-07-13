/**
 * T4 — marketDataService (cache, blacklist dinâmica, fallback).
 * 100% determinístico: Mongoose e o serviço externo são mockados — sem rede/DB.
 * Foca em refreshQuotesBatch (freshness de cache, skip de inativos, failCount
 * com teto/coerção do B2) e em normalizeSymbol.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import { externalMarketService } from '../services/externalMarketService.js';
import { marketDataService } from '../services/marketDataService.js';

vi.mock('../models/MarketAsset.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), bulkWrite: vi.fn() },
}));
vi.mock('../models/AssetHistory.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), create: vi.fn() } }));
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

// Helper: faz AssetHistory.find(...).select(...) resolver para os docs dados.
const mockHistoryFind = (docs) => {
  AssetHistory.find.mockReturnValue({ select: vi.fn().mockResolvedValue(docs) });
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
    expect(set.change).toBe(1.5);
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

  it('gate de 1 falha/dia: não incrementa se já falhou hoje', async () => {
    mockFind([{ ticker: 'FAIL3', updatedAt: minutesAgo(60), lastPrice: 5, isActive: true, failCount: 5, lastFailDate: new Date() }]);
    externalMarketService.getQuotes.mockResolvedValue([]); // falha de novo no mesmo dia

    await marketDataService.refreshQuotesBatch(['FAIL3'], false);

    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled(); // falha do dia já contabilizada → nenhuma operação
  });

  it('protege blue chips: ativo grande não é desativado mesmo ao atingir o teto', async () => {
    mockFind([{ ticker: 'PETR4', updatedAt: minutesAgo(60), lastPrice: 38, isActive: true, failCount: 9, marketCap: 2_000_000_000 }]);
    externalMarketService.getQuotes.mockResolvedValue([]);

    await marketDataService.refreshQuotesBatch(['PETR4'], false);

    const ops = MarketAsset.bulkWrite.mock.calls[0][0];
    const set = ops[0].updateOne.update.$set;
    expect(set.failCount).toBe(10); // continua contando para alerta
    expect(set.isActive).toBeUndefined(); // mas NUNCA é desativado automaticamente
  });
});

describe('getMarketDataMap — lote sem N+1 (5.8) / cada uma por si (5.3)', () => {
  it('lista vazia → Map vazio, sem tocar o banco', async () => {
    const map = await marketDataService.getMarketDataMap([]);
    expect(map.size).toBe(0);
    expect(MarketAsset.find).not.toHaveBeenCalled();
  });

  it('resolve preço do MarketAsset em UMA query e usa a chave ORIGINAL do chamador', async () => {
    mockFind([
      { ticker: 'PETR4', name: 'Petrobras', sector: 'Energia', lastPrice: 40, change: 1.2, dy: 8 },
      { ticker: 'MXRF11', name: 'Maxi Renda', sector: 'FII', lastPrice: 10, change: -0.5, dy: 12 },
    ]);

    // 'petr4.SA' chega normalizado para a query, mas a chave do Map é a original.
    const map = await marketDataService.getMarketDataMap(['petr4.SA', 'MXRF11']);

    expect(MarketAsset.find).toHaveBeenCalledTimes(1);
    expect(AssetHistory.find).not.toHaveBeenCalled(); // todos tinham lastPrice
    expect(map.get('petr4.SA')).toEqual({ price: 40, change: 1.2, name: 'Petrobras', sector: 'Energia', dy: 8 });
    expect(map.get('MXRF11').price).toBe(10);
  });

  it('cai no histórico (1 query) quando o ativo não tem lastPrice', async () => {
    mockFind([{ ticker: 'XPTO3', name: 'Xpto', sector: 'Outros', lastPrice: 0 }]);
    mockHistoryFind([
      { ticker: 'XPTO3', history: [
        { date: '2026-06-10', close: 7 },
        { date: '2026-06-16', close: 9 }, // mais recente vence
      ] },
    ]);

    const map = await marketDataService.getMarketDataMap(['XPTO3']);

    expect(AssetHistory.find).toHaveBeenCalledTimes(1);
    expect(map.get('XPTO3')).toMatchObject({ price: 9, isFallback: true });
  });

  it('ticker sem dado vira price 0 e NÃO derruba os demais', async () => {
    mockFind([{ ticker: 'VALE3', name: 'Vale', sector: 'Mineração', lastPrice: 60, change: 0 }]);
    mockHistoryFind([]); // sem histórico para o desconhecido

    const map = await marketDataService.getMarketDataMap(['VALE3', 'NADA9']);

    expect(map.get('VALE3').price).toBe(60);
    expect(map.get('NADA9')).toEqual({ price: 0, change: 0, name: 'NADA9', sector: 'Outros' });
  });

  it('falha total de DB → toda chave pedida ainda existe com price 0 (resiliência)', async () => {
    MarketAsset.find.mockReturnValue({ select: vi.fn().mockRejectedValue(new Error('db down')) });

    const map = await marketDataService.getMarketDataMap(['PETR4', 'MXRF11']);

    expect(map.get('PETR4')).toEqual({ price: 0, change: 0, name: 'PETR4', sector: 'Outros' });
    expect(map.get('MXRF11').price).toBe(0);
  });
});
