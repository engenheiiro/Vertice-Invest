/**
 * T4 — marketDataService (cache, blacklist dinâmica, fallback).
 * 100% determinístico: Mongoose e o serviço externo são mockados — sem rede/DB.
 * Foca em refreshQuotesBatch (freshness de cache, skip de inativos, failCount
 * com teto/coerção do B2) e em normalizeSymbol.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MarketAsset from '../models/MarketAsset.js';
import AssetHistory from '../models/AssetHistory.js';
import UserAsset from '../models/UserAsset.js';
import { externalMarketService } from '../services/externalMarketService.js';
import { marketDataService } from '../services/marketDataService.js';

vi.mock('../models/MarketAsset.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), bulkWrite: vi.fn() },
}));
vi.mock('../models/AssetHistory.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), create: vi.fn() } }));
vi.mock('../models/UserAsset.js', () => ({ default: { distinct: vi.fn().mockResolvedValue([]) } }));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../services/externalMarketService.js', () => ({
  externalMarketService: { getQuotes: vi.fn(), getFullHistory: vi.fn() },
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
afterEach(() => vi.restoreAllMocks());

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

describe('getMarketDataByTicker — stale-while-revalidate interativo', () => {
  it('responde o cache stale sem esperar a rede e renova em background', async () => {
    MarketAsset.findOne.mockResolvedValue({
      ticker: 'PETR4', type: 'STOCK', name: 'Petrobras', sector: 'Energia',
      lastPrice: 40, change: 1.2, updatedAt: minutesAgo(60),
    });
    let finishRefresh;
    const refresh = vi.spyOn(marketDataService, 'refreshQuotesBatch')
      .mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));

    const result = await marketDataService.getMarketDataByTicker('PETR4', { interactive: true });

    expect(result).toMatchObject({ price: 40, cacheStatus: 'STALE', isStale: true });
    expect(refresh).toHaveBeenCalledWith(['PETR4'], true);
    finishRefresh();
    await refresh.mock.results[0].value;
  });

  it('deduplica refresh concorrente do mesmo ticker (single-flight)', async () => {
    MarketAsset.findOne.mockResolvedValue({
      ticker: 'VALE3', type: 'STOCK', name: 'Vale', sector: 'Mineração',
      lastPrice: 60, change: 0.5, updatedAt: minutesAgo(60),
    });
    let finishRefresh;
    const refresh = vi.spyOn(marketDataService, 'refreshQuotesBatch')
      .mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));

    const [a, b] = await Promise.all([
      marketDataService.getMarketDataByTicker('VALE3', { interactive: true }),
      marketDataService.getMarketDataByTicker('VALE3', { interactive: true }),
    ]);

    expect(a.price).toBe(60);
    expect(b.price).toBe(60);
    expect(refresh).toHaveBeenCalledTimes(1);
    finishRefresh();
    await refresh.mock.results[0].value;
  });

  it('cache fresco não agenda refresh', async () => {
    MarketAsset.findOne.mockResolvedValue({
      ticker: 'ITUB4', type: 'STOCK', name: 'Itaú', sector: 'Financeiro',
      lastPrice: 35, updatedAt: minutesAgo(1),
    });
    const refresh = vi.spyOn(marketDataService, 'refreshQuotesBatch');

    await expect(marketDataService.getMarketDataByTicker('ITUB4', { interactive: true }))
      .resolves.toMatchObject({ price: 35, cacheStatus: 'HIT', isStale: false });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('refreshQuotesBatch — data da sessão', () => {
  // A variação só pode ser exibida como "hoje" se soubermos de que pregão ela é.
  // updatedAt não serve: ele marca quando perguntamos, e o refresh da madrugada
  // regrava o fechamento da véspera com um carimbo de hoje.
  it('grava priceDate no calendário BRASILEIRO junto do change', async () => {
    mockFind([{ ticker: 'PETR4', updatedAt: minutesAgo(60), lastPrice: 40, isActive: true, failCount: 0 }]);
    // 31/08 às 17:55 BRT (fechamento da B3) = 20:55Z.
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'PETR4', price: 42, change: 1.5, previousClose: 41.38, marketTime: new Date('2026-08-31T20:55:00.000Z') },
    ]);

    await marketDataService.refreshQuotesBatch(['PETR4'], false);

    const set = MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.priceDate).toBe('2026-08-31');
    expect(set.change).toBe(1.5);
    expect(set.previousClose).toBe(41.38);
  });

  it('fonte sem horário grava null — nunca a data de hoje por conveniência', async () => {
    mockFind([{ ticker: 'PETR4', updatedAt: minutesAgo(60), lastPrice: 40, isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([{ ticker: 'PETR4', price: 42, change: 1.5 }]);

    await marketDataService.refreshQuotesBatch(['PETR4'], false);

    const set = MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.priceDate).toBeNull();
    expect(set.previousClose).toBe(0); // 0 = não publicado; a cripto cai na janela de 24h
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

describe('tryReactivateAssets — blacklist é estado terminal', () => {
  it('consulta apenas inativos NÃO-blacklistados (deslistados não são re-cotados)', async () => {
    mockFind([]); // nenhum inativo elegível → retorna cedo
    await marketDataService.tryReactivateAssets();
    // O filtro precisa excluir isBlacklisted — senão SGEN/IPG/EURP11/BDRX11 voltavam
    // ao loop todo run, disparando 404 na brapi e poluindo os warnings.
    expect(MarketAsset.find).toHaveBeenCalledWith({ isActive: false, isBlacklisted: false });
    expect(externalMarketService.getQuotes).not.toHaveBeenCalled();
  });

  it('reativa inativo (não-blacklistado) que volta a cotar', async () => {
    mockFind([{ ticker: 'BPAN4', failCount: 10, type: 'STOCK', marketCap: 2e9 }]);
    externalMarketService.getQuotes.mockResolvedValue([{ ticker: 'BPAN4', price: 12.75, change: 1.2 }]);
    MarketAsset.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
    const res = await marketDataService.tryReactivateAssets();
    expect(res.reactivated).toBe(1);
    const set = MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set).toMatchObject({ isActive: true, failCount: 0, lastPrice: 12.75 });
  });
});

// A lista de inativos só crescia: sem baixa automática, cada papel morto voltava
// ao mesmo warn a cada sync (27 tickers, alguns há 192 dias, em 30/08/2026).
describe('tryReactivateAssets — aposentadoria automática após a quarentena', () => {
  const daysAgo = (d) => new Date(Date.now() - d * 86400000);

  it('aposenta (blacklist) quem passou 90d inativo sem cotar em nenhuma fonte', async () => {
    mockFind([{ ticker: 'MMC', failCount: 10, type: 'STOCK_US', marketCap: 0, updatedAt: daysAgo(127) }]);
    externalMarketService.getQuotes.mockResolvedValue([]); // segue sem cotar
    externalMarketService.getFullHistory.mockResolvedValue(null); // nem histórico
    MarketAsset.bulkWrite.mockResolvedValue({ modifiedCount: 1 });

    const res = await marketDataService.tryReactivateAssets();

    expect(res.retired).toBe(1);
    const op = MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.filter).toEqual({ ticker: 'MMC', isBlacklisted: false }); // idempotente
    expect(op.update.$set.isBlacklisted).toBe(true);
    expect(op.update.$set.retiredReason).toMatch(/127d sem cotação/);
  });

  it('não aposenta dentro da quarentena — papel ainda pode voltar sozinho', async () => {
    mockFind([{ ticker: 'HGPO11', failCount: 10, type: 'FII', marketCap: 2.7e8, updatedAt: daysAgo(33) }]);
    externalMarketService.getQuotes.mockResolvedValue([]);

    const res = await marketDataService.tryReactivateAssets();

    expect(res.retired).toBe(0);
    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled();
  });

  it('nunca aposenta no automático ticker detido em carteira', async () => {
    mockFind([{ ticker: 'TKNO4', failCount: 10, type: 'STOCK', marketCap: 6e8, updatedAt: daysAgo(200) }]);
    externalMarketService.getQuotes.mockResolvedValue([]);
    UserAsset.distinct.mockResolvedValueOnce(['TKNO4']);

    const res = await marketDataService.tryReactivateAssets();

    expect(res.retired).toBe(0);
    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled();
  });

  it('candle recente segura a baixa: papel que negocia mas não cota via quote fica', async () => {
    // HGPO11: FII ilíquido sem quote no Yahoo, com candle de 2 dias atrás.
    mockFind([{ ticker: 'HGPO11', failCount: 10, type: 'FII', marketCap: 2.7e8, updatedAt: daysAgo(120) }]);
    externalMarketService.getQuotes.mockResolvedValue([]);
    externalMarketService.getFullHistory.mockResolvedValue([{ date: daysAgo(2).toISOString().slice(0, 10), close: 153.42 }]);

    const res = await marketDataService.tryReactivateAssets();

    expect(res.retired).toBe(0);
    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled();
  });

  it('failCount baixo não aposenta, por mais parado que esteja (doc recém-criado)', async () => {
    mockFind([{ ticker: 'NOVO3', failCount: 2, type: 'STOCK', marketCap: 0, updatedAt: daysAgo(300) }]);
    externalMarketService.getQuotes.mockResolvedValue([]);

    const res = await marketDataService.tryReactivateAssets();

    expect(res.retired).toBe(0);
    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled();
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
      { ticker: 'PETR4', name: 'Petrobras', sector: 'Energia', lastPrice: 40, change: 1.2, priceDate: '2026-08-31', previousClose: 39.53, dy: 8 },
      { ticker: 'MXRF11', name: 'Maxi Renda', sector: 'FII', lastPrice: 10, change: -0.5, dy: 12 },
    ]);

    // 'petr4.SA' chega normalizado para a query, mas a chave do Map é a original.
    const map = await marketDataService.getMarketDataMap(['petr4.SA', 'MXRF11']);

    expect(MarketAsset.find).toHaveBeenCalledTimes(1);
    expect(AssetHistory.find).not.toHaveBeenCalled(); // todos tinham lastPrice
    // priceDate viaja junto do change: quem consome a variação precisa saber de
    // que pregão ela é (ver walletController).
    expect(map.get('petr4.SA')).toEqual({ price: 40, change: 1.2, priceDate: '2026-08-31', previousClose: 39.53, name: 'Petrobras', sector: 'Energia', dy: 8 });
    expect(map.get('MXRF11').priceDate).toBeNull(); // doc sem o campo → null explícito
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

describe('histórico tipado V5 — cache e resiliência', () => {
  const candles = [{ date: '2026-07-30', close: 64_725, adjClose: 64_725 }];

  it('cripto consulta e cria BTC-USD sem colidir com a ação BTC', async () => {
    AssetHistory.findOne.mockResolvedValue(null);
    externalMarketService.getFullHistory.mockResolvedValue(candles);
    AssetHistory.create.mockImplementation(async (doc) => doc);

    await expect(marketDataService.getBenchmarkHistory('btc', 'crypto')).resolves.toEqual(candles);
    expect(AssetHistory.findOne).toHaveBeenCalledWith({ ticker: 'BTC-USD' });
    expect(externalMarketService.getFullHistory).toHaveBeenCalledWith('BTC', 'CRYPTO');
    expect(AssetHistory.create).toHaveBeenCalledWith(expect.objectContaining({ ticker: 'BTC-USD' }));
  });

  it('ticker homônimo STOCK_US permanece na chave BTC', async () => {
    const entry = { ticker: 'BTC', lastUpdated: new Date(), history: [{ date: '2026-07-30', close: 28.63 }] };
    AssetHistory.findOne.mockResolvedValue(entry);

    await expect(marketDataService.getBenchmarkHistory('BTC', 'STOCK_US')).resolves.toEqual(entry.history);
    expect(AssetHistory.findOne).toHaveBeenCalledWith({ ticker: 'BTC' });
    expect(externalMarketService.getFullHistory).not.toHaveBeenCalled();
  });

  it('cache fresco evita rede', async () => {
    const entry = { ticker: 'BTC-USD', lastUpdated: new Date(), history: candles };
    AssetHistory.findOne.mockResolvedValue(entry);
    await expect(marketDataService.getBenchmarkHistory('BTC', 'CRYPTO')).resolves.toEqual(candles);
    expect(externalMarketService.getFullHistory).not.toHaveBeenCalled();
  });

  it('provedor fora do ar devolve cache stale em vez de apagar a série', async () => {
    const stale = { ticker: 'BTC-USD', lastUpdated: new Date(0), history: candles, save: vi.fn() };
    AssetHistory.findOne.mockResolvedValue(stale);
    externalMarketService.getFullHistory.mockRejectedValue(new Error('timeout'));

    await expect(marketDataService.getBenchmarkHistory('BTC', 'CRYPTO')).resolves.toEqual(candles);
    expect(stale.save).not.toHaveBeenCalled();
  });

  it('sem cache e com provedor fora do ar retorna null sem lançar', async () => {
    AssetHistory.findOne.mockResolvedValue(null);
    externalMarketService.getFullHistory.mockRejectedValue(new Error('timeout'));
    await expect(marketDataService.getBenchmarkHistory('BTC', 'CRYPTO')).resolves.toBeNull();
  });

  it('getPriceAtDate usa chave tipada e somente data anterior na aproximação', async () => {
    AssetHistory.findOne.mockResolvedValue({
      ticker: 'ETH-USD',
      history: [
        { date: '2026-07-28', close: 1_800, adjClose: 1_800 },
        { date: '2026-07-30', close: 1_900, adjClose: 1_890 },
      ],
    });
    await expect(marketDataService.getPriceAtDate('ETH', '2026-07-29', 'CRYPTO')).resolves.toEqual({
      price: 1_800,
      adjustedPrice: 1_800,
      source: 'history_approx',
      foundDate: '2026-07-28',
    });
    expect(AssetHistory.findOne).toHaveBeenCalledWith({ ticker: 'ETH-USD' });
  });
});

/**
 * Aposentado NÃO é perguntado — e a flag que manda é `isBlacklisted`.
 *
 * O filtro lia só `isActive`, apostando que os dois campos andam juntos. Não
 * andam: em 04/09/2026 havia 12 ativos com isBlacklisted=true e isActive=true,
 * blacklistados por caminhos antigos que não desativavam. IGBR3 e BLUT4 eram
 * perguntados a cada 15 minutos, desciam Yahoo → Google → Brapi e falhavam nos
 * três — para sempre. Papel aposentado gastando as três fontes é o oposto do que
 * a blacklist existe para fazer.
 */
describe('refreshQuotesBatch — blacklist é a flag que decide', () => {
  it('não pergunta cotação de ativo blacklistado, mesmo com isActive=true', async () => {
    mockFind([{ ticker: 'IGBR3', updatedAt: minutesAgo(600), lastPrice: 1.5, isActive: true, isBlacklisted: true, failCount: 1 }]);

    await marketDataService.refreshQuotesBatch(['IGBR3'], false);

    expect(externalMarketService.getQuotes).not.toHaveBeenCalled();
  });

  it('nem com force — aposentadoria é estado terminal', async () => {
    mockFind([{ ticker: 'BLUT4', updatedAt: minutesAgo(600), lastPrice: 1.5, isActive: true, isBlacklisted: true, failCount: 1 }]);

    await marketDataService.refreshQuotesBatch(['BLUT4'], true);

    expect(externalMarketService.getQuotes).not.toHaveBeenCalled();
  });

  it('ativo normal segue sendo perguntado', async () => {
    mockFind([{ ticker: 'PETR4', updatedAt: minutesAgo(600), lastPrice: 40, isActive: true, isBlacklisted: false, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([{ ticker: 'PETR4', price: 42, change: 1 }]);

    await marketDataService.refreshQuotesBatch(['PETR4'], false);

    expect(externalMarketService.getQuotes).toHaveBeenCalledWith(['PETR4']);
  });
});
