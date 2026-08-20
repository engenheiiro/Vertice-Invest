/**
 * COBERTURA DO UNIVERSO PELO timeSeriesWorker.
 *
 * Em 19/08/2026 o run das 18:30 morreu 62s depois de começar: o JobRun
 * `daily-evening` ficou RUNNING para sempre, o worker visitou exatamente as
 * posições 0–233 da lista e os outros 1.066 ativos (82% do universo) não foram
 * tocados. Como a ordem era a natural do Mongo — estável entre runs — o dia
 * seguinte reatendia a MESMA cabeça e a cauda seguia congelada: 660 séries
 * paradas na mesma data, 66,8% do universo de pesquisa defasado.
 *
 * Dois defeitos, cobertos aqui:
 *  1. Ordem fixa → nenhuma retomada. Agora a fila é por `lastCheckedAt`, então o
 *     que sobrou de ontem encabeça a fila de hoje.
 *  2. `bulkWrite` único no fim → run interrompido perdia TODAS as métricas já
 *     calculadas (beta/SMA/EMA/volatilidade), enquanto os candles sobreviviam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    marketAssetFind: vi.fn(),
    marketAssetBulkWrite: vi.fn(),
    historyFind: vi.fn(),
    historyUpdateOne: vi.fn(),
    historyUpdateMany: vi.fn(),
    systemConfigUpdate: vi.fn(),
    getFullHistory: vi.fn(),
    getBenchmarkHistory: vi.fn(),
}));

vi.mock('../models/MarketAsset.js', () => ({
    default: { find: mocks.marketAssetFind, bulkWrite: mocks.marketAssetBulkWrite },
}));
vi.mock('../models/AssetHistory.js', () => ({
    default: {
        find: mocks.historyFind,
        updateOne: mocks.historyUpdateOne,
        updateMany: mocks.historyUpdateMany,
    },
}));
vi.mock('../models/SystemConfig.js', () => ({
    default: { findOneAndUpdate: mocks.systemConfigUpdate },
}));
vi.mock('../services/externalMarketService.js', () => ({
    externalMarketService: { getFullHistory: mocks.getFullHistory },
}));
vi.mock('../services/marketDataService.js', () => ({
    marketDataService: { getBenchmarkHistory: mocks.getBenchmarkHistory },
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { timeSeriesWorker, orderByStaleness, METRICS_FLUSH_SIZE } =
    await import('../services/workers/timeSeriesWorker.js');
const logger = (await import('../config/logger.js')).default;

// Série longa o bastante para o worker calcular métricas (>= 20 candles).
const candles = (n, lastDate = '2026-08-19') => {
    const end = new Date(`${lastDate}T00:00:00Z`).getTime();
    return Array.from({ length: n }, (_, i) => ({
        date: new Date(end - (n - 1 - i) * 86400000).toISOString().slice(0, 10),
        close: 100 + i,
        adjClose: 100 + i,
        volume: 1000,
    }));
};

/** `MarketAsset.find(...).select(...).lean()` do worker. */
const marketAssetQuery = (assets) => ({ select: () => ({ lean: async () => assets }) });

describe('orderByStaleness', () => {
    const assets = [
        { ticker: 'AAA3', type: 'STOCK' },
        { ticker: 'BBB3', type: 'STOCK' },
        { ticker: 'CCC3', type: 'STOCK' },
    ];

    it('quem nunca foi visitado encabeça a fila', () => {
        const ordered = orderByStaleness(assets, new Map([['AAA3', 5000], ['CCC3', 1000]]));
        expect(ordered.map(a => a.ticker)).toEqual(['BBB3', 'CCC3', 'AAA3']);
    });

    it('RETOMADA: a cauda não visitada ontem vira a cabeça de hoje', () => {
        // Run truncado: AAA3 e BBB3 foram visitados, CCC3 não.
        const ordered = orderByStaleness(assets, new Map([['AAA3', 9000], ['BBB3', 9000], ['CCC3', 10]]));
        expect(ordered[0].ticker).toBe('CCC3');
    });

    it('empate mantém a ordem natural (lote inteiro tocado no mesmo updateMany)', () => {
        const ordered = orderByStaleness(assets, new Map([['AAA3', 7], ['BBB3', 7], ['CCC3', 7]]));
        expect(ordered.map(a => a.ticker)).toEqual(['AAA3', 'BBB3', 'CCC3']);
    });

    it('usa a chave de armazenamento, não o ticker cru (cripto é namespaced)', () => {
        const cripto = [{ ticker: 'BTC', type: 'CRYPTO' }, { ticker: 'PETR4', type: 'STOCK' }];
        // Chave 'BTC' (sem sufixo) não pode casar com a cripto: ela é 'BTC-USD'.
        const ordered = orderByStaleness(cripto, new Map([['BTC-USD', 9000], ['PETR4', 10]]));
        expect(ordered.map(a => a.ticker)).toEqual(['PETR4', 'BTC']);
    });

    it('lista vazia não quebra', () => {
        expect(orderByStaleness([], new Map())).toEqual([]);
    });
});

describe('timeSeriesWorker.run — cobertura e durabilidade', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mocks.getBenchmarkHistory.mockResolvedValue([]);
        mocks.historyUpdateOne.mockResolvedValue({});
        mocks.historyUpdateMany.mockResolvedValue({});
        mocks.marketAssetBulkWrite.mockResolvedValue({});
        mocks.systemConfigUpdate.mockResolvedValue({});
        mocks.getFullHistory.mockResolvedValue(candles(40));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** Executa o run adiantando os `setTimeout(1000)` de throttle entre lotes. */
    const runWorker = async () => {
        const promise = timeSeriesWorker.run();
        await vi.runAllTimersAsync();
        await promise;
    };

    it('atende primeiro os ativos com visita mais antiga', async () => {
        const assets = [
            { ticker: 'VELHO3', type: 'STOCK' },
            { ticker: 'NOVO3', type: 'STOCK' },
            { ticker: 'NUNCA3', type: 'STOCK' },
        ];
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        // 1ª chamada = varredura de lastCheckedAt; demais = histórico do lote.
        mocks.historyFind
            .mockReturnValueOnce({ lean: async () => [
                { ticker: 'VELHO3', lastCheckedAt: new Date('2026-08-10T00:00:00Z') },
                { ticker: 'NOVO3', lastCheckedAt: new Date('2026-08-19T00:00:00Z') },
            ] })
            .mockReturnValue({ lean: async () => [] });

        await runWorker();

        expect(mocks.getFullHistory.mock.calls.map(c => c[0]))
            .toEqual(['NUNCA3', 'VELHO3', 'NOVO3']);
    });

    it('falha na fonte também marca a visita — ticker morto não trava a fila', async () => {
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery([{ ticker: 'MORTO3', type: 'STOCK' }]));
        mocks.historyFind.mockReturnValue({ lean: async () => [] });
        mocks.getFullHistory.mockRejectedValue(new Error('No data found'));

        await runWorker();

        // lastCheckedAt renovado (sem upsert: nada de criar série vazia).
        expect(mocks.historyUpdateMany).toHaveBeenCalledWith(
            { ticker: { $in: ['MORTO3'] } },
            { $set: { lastCheckedAt: expect.any(Date) } },
        );
        expect(mocks.historyUpdateOne).not.toHaveBeenCalled();
    });

    it('grava métricas em lotes parciais, não só no fim do run', async () => {
        const assets = Array.from({ length: METRICS_FLUSH_SIZE + 25 }, (_, i) => ({
            ticker: `AT${i}`, type: 'STOCK',
        }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        mocks.historyFind.mockReturnValue({ lean: async () => [] });

        await runWorker();

        expect(mocks.marketAssetBulkWrite.mock.calls.length).toBeGreaterThan(1);
        const gravadas = mocks.marketAssetBulkWrite.mock.calls
            .reduce((sum, [ops]) => sum + ops.length, 0);
        expect(gravadas).toBe(assets.length);
    });

    it('REGRESSÃO: run interrompido preserva as métricas já calculadas', async () => {
        const assets = Array.from({ length: 40 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        let lote = 0;
        mocks.historyFind.mockImplementation(() => {
            // 1ª chamada é a varredura de lastCheckedAt; o corte vem depois de 4 lotes.
            if (lote++ === 5) throw new Error('conexão perdida no meio do run');
            return { lean: async () => [] };
        });

        await runWorker();

        // O bulkWrite único no fim nunca teria acontecido; o flush do caminho de erro sim.
        const gravadas = mocks.marketAssetBulkWrite.mock.calls
            .reduce((sum, [ops]) => sum + ops.length, 0);
        expect(gravadas).toBe(20); // 4 lotes de 5 concluídos antes do corte
    });

    it('cobertura incompleta é denunciada no log e gravada no SystemConfig', async () => {
        const assets = Array.from({ length: 20 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        let lote = 0;
        mocks.historyFind.mockImplementation(() => {
            if (lote++ === 3) throw new Error('processo derrubado');
            return { lean: async () => [] };
        });

        await runWorker();

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cobertura INCOMPLETA'));
        const stats = mocks.systemConfigUpdate.mock.calls.at(-1)[1].$set.lastTimeSeriesStats;
        expect(stats.complete).toBe(false);
        expect(stats.visited).toBe(10);
        expect(stats.total).toBe(20);
    });

    it('run completo registra 100% de cobertura', async () => {
        const assets = Array.from({ length: 12 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        mocks.historyFind.mockReturnValue({ lean: async () => [] });

        await runWorker();

        const stats = mocks.systemConfigUpdate.mock.calls.at(-1)[1].$set.lastTimeSeriesStats;
        expect(stats).toMatchObject({ complete: true, visited: 12, total: 12, fetched: 12, failed: 0 });
        expect(stats.assetsProcessed).toBe(12);
    });
});
