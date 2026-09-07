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
import { getSuspectQuotes, resetSourceStats } from '../utils/sourceHealth.js';

vi.mock('../models/MarketAsset.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), bulkWrite: vi.fn() },
}));
vi.mock('../models/AssetHistory.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), create: vi.fn(), aggregate: vi.fn().mockResolvedValue([]) } }));
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

    // O tipo do ativo viaja junto: é o que impede sigla disputada (STX é
    // Stacks e Seagate) de trazer o preço do ativo errado.
    expect(externalMarketService.getQuotes).toHaveBeenCalledWith(['PETR4'], {
      typeByTicker: expect.any(Map),
    });
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
    // Estado terminal COMPLETO na mesma escrita: baixa sem desativar deixava o
    // aposentado na fila de cotação (isBlacklisted=true + isActive=true).
    expect(op.update.$set.isActive).toBe(false);
    expect(op.update.$set.retiredReason).toMatch(/127d sem pregão/);
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
  // A gravação passa por `mergeCandleSeries` desde 06/09/2026, e ela normaliza o
  // candle — `volume` ausente vira 0, como já acontecia no worker e no caminho da
  // carteira. É o formato que fica guardado, então é o que o teste cobra.
  const guardados = candles.map((c) => ({ ...c, volume: 0 }));

  it('cripto consulta e cria BTC-USD sem colidir com a ação BTC', async () => {
    AssetHistory.findOne.mockResolvedValue(null);
    externalMarketService.getFullHistory.mockResolvedValue(candles);
    AssetHistory.create.mockImplementation(async (doc) => doc);

    await expect(marketDataService.getBenchmarkHistory('btc', 'crypto')).resolves.toEqual(guardados);
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

    // O tipo do ativo viaja junto: é o que impede sigla disputada (STX é
    // Stacks e Seagate) de trazer o preço do ativo errado.
    expect(externalMarketService.getQuotes).toHaveBeenCalledWith(['PETR4'], {
      typeByTicker: expect.any(Map),
    });
  });
});

/**
 * O PREÇO FICA, A VARIAÇÃO CONTESTADA NÃO.
 *
 * XPIN11 em 05/09/2026 chegou com preço 62,04 (que bate com o fechamento oficial
 * da B3) e, na mesma resposta, `change` de +108% com `previousClose` de 29,82 —
 * enquanto a nossa série mostrava 62,04 parado havia semanas. Guardar o par da
 * fonte é servir "+108% hoje" na carteira; recusar o preço é jogar fora o número
 * certo. A saída é reancorar no candle que o snapshot diário já usa.
 */
describe('refreshQuotesBatch — variação contestada', () => {
  const anchor = (close) => AssetHistory.aggregate.mockResolvedValue([
    { ticker: 'XPIN11', candle: { date: '2026-09-02', close } },
  ]);

  it('reancora no nosso fechamento e descarta o par da fonte', async () => {
    mockFind([{ ticker: 'XPIN11', type: 'FII', updatedAt: minutesAgo(60), lastPrice: 62.04, priceDate: '2026-09-02', isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'XPIN11', price: 62.04, change: 108.0769, previousClose: 29.8159, marketTime: new Date('2026-09-03T20:55:00.000Z') },
    ]);
    anchor(62.04);

    await marketDataService.refreshQuotesBatch(['XPIN11'], false);

    const set = MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.lastPrice).toBe(62.04);   // o preço da fonte fica
    expect(set.change).toBe(0);          // a variação dela, não
    expect(set.previousClose).toBe(62.04);
  });

  it('preserva o movimento que o nosso candle confirma', async () => {
    mockFind([{ ticker: 'XPIN11', type: 'FII', updatedAt: minutesAgo(60), lastPrice: 100, priceDate: '2026-09-02', isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'XPIN11', price: 135, change: 200, previousClose: 45, marketTime: new Date('2026-09-03T20:55:00.000Z') },
    ]);
    anchor(100);

    await marketDataService.refreshQuotesBatch(['XPIN11'], false);

    const set = MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.change).toBeCloseTo(35, 6);
  });

  // A âncora é acessória; a cotação não. Perder o lote inteiro por uma consulta
  // de apoio seria trocar um número torto por nenhum número.
  it('falha na busca da âncora não derruba o lote de preços', async () => {
    mockFind([{ ticker: 'XPIN11', type: 'FII', updatedAt: minutesAgo(60), lastPrice: 62.04, priceDate: '2026-09-02', isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'XPIN11', price: 62.04, change: 108.0769, previousClose: 29.8159, marketTime: new Date('2026-09-03T20:55:00.000Z') },
    ]);
    AssetHistory.aggregate.mockRejectedValue(new Error('sem banco'));

    await marketDataService.refreshQuotesBatch(['XPIN11'], false);

    const set = MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.lastPrice).toBe(62.04);
    expect(set.change).toBe(0);
  });

  // Dia normal continua vindo da fonte: a reancoragem é exceção, não regra.
  it('não mexe na variação quando a fonte é coerente', async () => {
    mockFind([{ ticker: 'PETR4', type: 'STOCK', updatedAt: minutesAgo(60), lastPrice: 41.38, priceDate: '2026-09-02', isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'PETR4', price: 42, change: 1.4983, previousClose: 41.38, marketTime: new Date('2026-09-03T20:55:00.000Z') },
    ]);

    await marketDataService.refreshQuotesBatch(['PETR4'], false);

    const set = MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.change).toBe(1.4983);
    expect(set.previousClose).toBe(41.38);
    expect(AssetHistory.aggregate).not.toHaveBeenCalled();
  });
});

/**
 * ── O RELÓGIO DA BAIXA MEDE PREGÃO, NÃO O ÚLTIMO TOQUE NO DOCUMENTO ──────────
 *
 * PTNT3/PTNT4 (Pettenati) não negociam desde 26 e 27/05/2026 — 104 dias em
 * 07/09 —, com UM único candle na série, `priceDate` nulo e failCount no teto.
 * Uma escrita de 29/07 (backfill) tinha empurrado o `updatedAt`, e os dois
 * marcavam 40 dias de quarentena em vez de 104: a baixa era adiada a cada toque.
 */
describe('aposentadoria — a idade é da última prova de pregão', () => {
  const daysAgo = (d) => new Date(Date.now() - d * 86400000);
  const dayKeyAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  it('PTNT3 — candle de 104d aposenta mesmo com updatedAt de 40d', async () => {
    mockFind([{ ticker: 'PTNT3', failCount: 10, type: 'STOCK', marketCap: 4e8, updatedAt: daysAgo(40), priceDate: null }]);
    AssetHistory.aggregate.mockResolvedValue([{ ticker: 'PTNT3', lastDate: dayKeyAgo(104) }]);
    externalMarketService.getQuotes.mockResolvedValue([]);
    externalMarketService.getFullHistory.mockResolvedValue(null);
    MarketAsset.bulkWrite.mockResolvedValue({ modifiedCount: 1 });

    const res = await marketDataService.tryReactivateAssets();

    expect(res.retired).toBe(1);
    const set = MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.isBlacklisted).toBe(true);
    expect(set.retiredReason).toMatch(/104d sem pregão \(último candle\)/);
  });

  it('o inverso também vale: updatedAt velho não mata quem negociou ontem', async () => {
    // A prova de vida pode estar só na série — e basta ela.
    mockFind([{ ticker: 'VIVO3', failCount: 10, type: 'STOCK', marketCap: 4e8, updatedAt: daysAgo(300), priceDate: null }]);
    AssetHistory.aggregate.mockResolvedValue([{ ticker: 'VIVO3', lastDate: dayKeyAgo(1) }]);
    externalMarketService.getQuotes.mockResolvedValue([]);

    const res = await marketDataService.tryReactivateAssets();

    expect(res.retired).toBe(0);
    expect(externalMarketService.getFullHistory).not.toHaveBeenCalled(); // nem chega ao probe
  });

  it('basta UMA testemunha: priceDate recente segura a baixa sem candle nenhum', async () => {
    mockFind([{ ticker: 'RARO11', failCount: 10, type: 'FII', marketCap: 1e8, updatedAt: daysAgo(300), priceDate: dayKeyAgo(3) }]);
    AssetHistory.aggregate.mockResolvedValue([]); // série ausente
    externalMarketService.getQuotes.mockResolvedValue([]);

    const res = await marketDataService.tryReactivateAssets();

    expect(res.retired).toBe(0);
  });

  it('e vale a MAIS RECENTE das duas, não a média nem a pior', async () => {
    mockFind([{ ticker: 'MEIO11', failCount: 10, type: 'FII', marketCap: 1e8, updatedAt: daysAgo(10), priceDate: dayKeyAgo(200) }]);
    AssetHistory.aggregate.mockResolvedValue([{ ticker: 'MEIO11', lastDate: dayKeyAgo(5) }]);
    externalMarketService.getQuotes.mockResolvedValue([]);

    expect((await marketDataService.tryReactivateAssets()).retired).toBe(0);
  });

  it('sem candle e sem priceDate, o updatedAt volta a ser a resposta — é a única', async () => {
    mockFind([{ ticker: 'NOVO11', failCount: 10, type: 'FII', marketCap: 0, updatedAt: daysAgo(5), priceDate: null }]);
    AssetHistory.aggregate.mockResolvedValue([]);
    externalMarketService.getQuotes.mockResolvedValue([]);

    expect((await marketDataService.tryReactivateAssets()).retired).toBe(0);
  });

  // Fail-CLOSED: a ausência da consulta não pode virar sentença de morte.
  it('série indisponível não aposenta ninguém nesta rodada', async () => {
    mockFind([{ ticker: 'PTNT4', failCount: 10, type: 'STOCK', marketCap: 4e8, updatedAt: daysAgo(400), priceDate: null }]);
    AssetHistory.aggregate.mockRejectedValue(new Error('mongo fora'));
    externalMarketService.getQuotes.mockResolvedValue([]);

    expect((await marketDataService.tryReactivateAssets()).retired).toBe(0);
    expect(MarketAsset.bulkWrite).not.toHaveBeenCalled();
  });

  it('o probe ao vivo continua sendo a última palavra sobre quem passou do prazo', async () => {
    // Nossa série diz 200 dias; a fonte diz que ele negociou há 2. Vence a fonte.
    mockFind([{ ticker: 'HGPO11', failCount: 10, type: 'FII', marketCap: 2.7e8, updatedAt: daysAgo(200), priceDate: null }]);
    AssetHistory.aggregate.mockResolvedValue([{ ticker: 'HGPO11', lastDate: dayKeyAgo(200) }]);
    externalMarketService.getQuotes.mockResolvedValue([]);
    externalMarketService.getFullHistory.mockResolvedValue([{ date: dayKeyAgo(2), close: 153.42 }]);

    expect((await marketDataService.tryReactivateAssets()).retired).toBe(0);
  });

  it('cripto é procurada pela chave de série do provedor, não pelo ticker cru', async () => {
    mockFind([{ ticker: 'SOL', failCount: 10, type: 'CRYPTO', marketCap: 0, updatedAt: daysAgo(300), priceDate: null }]);
    AssetHistory.aggregate.mockResolvedValue([{ ticker: 'SOL-USD', lastDate: dayKeyAgo(2) }]);
    externalMarketService.getQuotes.mockResolvedValue([]);

    expect((await marketDataService.tryReactivateAssets()).retired).toBe(0);
    const match = AssetHistory.aggregate.mock.calls[0][0][0].$match;
    expect(match.ticker.$in).toContain('SOL-USD');
  });
});

/**
 * ── O SALTO CONTRA O BANCO, JULGADO COM A NOSSA SÉRIE NA MÃO ────────────────
 *
 * Caso real de 07/09/2026: RBRL11 chegou a 73,91 e o banco tinha 58,45 — que é
 * o preço do RBHG11, outro FII, e não existe em nenhum dos nossos 400 candles
 * (o mínimo da série é 60,59, de fev/2025). O alarme apontava para o número
 * certo. Como o registro no painel agora acontece DEPOIS da busca da âncora, o
 * que se cobra aqui é que ele ainda aconteça — e com o veredito junto.
 */
describe('refreshQuotesBatch — quem estava errado no salto', () => {
  beforeEach(() => resetSourceStats());

  const quoteRBRL = { ticker: 'RBRL11', price: 73.91, change: 0.5, previousClose: 73.54, marketTime: new Date('2026-09-04T20:55:00.000Z'), source: 'YAHOO' };

  it('a nossa série absolve o preço novo e o painel diz isso', async () => {
    mockFind([{ ticker: 'RBRL11', type: 'FII', updatedAt: minutesAgo(60), lastPrice: 58.45, priceDate: '2026-09-04', priceSource: 'YAHOO', isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([quoteRBRL]);
    AssetHistory.aggregate.mockResolvedValue([{ ticker: 'RBRL11', candle: { date: '2026-09-03', close: 73.54 } }]);

    await marketDataService.refreshQuotesBatch(['RBRL11'], false);

    const [linha] = getSuspectQuotes();
    expect(linha.subject).toBe('RBRL11');
    const salto = linha.findings.find((f) => f.code === 'SALTO_VS_BANCO');
    expect(salto.arbitration).toBe('NOVO_CONFIRMADO');
    expect(salto.detail).toMatch(/quem estava errado era o guardado/);
    // E o preço bom entra assim mesmo — o conserto é a própria gravação.
    expect(MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set.lastPrice).toBe(73.91);
  });

  it('sem candle nosso o achado fica como estava — acusar sem prova é o que se evita', async () => {
    mockFind([{ ticker: 'RBRL11', type: 'FII', updatedAt: minutesAgo(60), lastPrice: 58.45, priceDate: '2026-09-04', isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([quoteRBRL]);
    AssetHistory.aggregate.mockResolvedValue([]);

    await marketDataService.refreshQuotesBatch(['RBRL11'], false);

    const [linha] = getSuspectQuotes();
    expect(linha.findings.find((f) => f.code === 'SALTO_VS_BANCO').arbitration).toBeUndefined();
  });

  it('a procedência do preço guardado vai junto na frase', async () => {
    mockFind([{ ticker: 'RBRL11', type: 'FII', updatedAt: minutesAgo(60), lastPrice: 58.45, priceDate: '2026-09-04', priceSource: 'FUNDAMENTUS', isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([quoteRBRL]);
    AssetHistory.aggregate.mockResolvedValue([]);

    await marketDataService.refreshQuotesBatch(['RBRL11'], false);

    expect(getSuspectQuotes()[0].findings[0].detail).toMatch(/guardado via FUNDAMENTUS/);
  });

  // Sem assinatura, todo preço errado é anônimo — e preço anônimo não se
  // conserta na raiz: dá para reescrever o número, nunca para saber de onde veio.
  it('toda gravação de preço assina a fonte', async () => {
    mockFind([{ ticker: 'PETR4', type: 'STOCK', updatedAt: minutesAgo(60), lastPrice: 41.38, priceDate: '2026-09-03', isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'PETR4', price: 42, change: 1.4983, previousClose: 41.38, marketTime: new Date('2026-09-04T20:55:00.000Z'), source: 'GOOGLE_FINANCE_FALLBACK' },
    ]);

    await marketDataService.refreshQuotesBatch(['PETR4'], false);

    expect(MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set.priceSource)
      .toBe('GOOGLE_FINANCE_FALLBACK');
  });

  it('papel de centavos que só andou alguns tiques não vira linha no painel', async () => {
    mockFind([{ ticker: 'PMAM3', type: 'STOCK', updatedAt: minutesAgo(60), lastPrice: 0.23, priceDate: '2026-09-03', isActive: true, failCount: 0 }]);
    externalMarketService.getQuotes.mockResolvedValue([
      { ticker: 'PMAM3', price: 0.32, change: 39.13, previousClose: 0.23, marketTime: new Date('2026-09-04T20:55:00.000Z'), source: 'YAHOO' },
    ]);

    await marketDataService.refreshQuotesBatch(['PMAM3'], false);

    expect(getSuspectQuotes()).toHaveLength(0);
    expect(MarketAsset.bulkWrite.mock.calls[0][0][0].updateOne.update.$set.lastPrice).toBe(0.32);
  });
});
