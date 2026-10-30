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

const {
    timeSeriesWorker, orderByStaleness, sessaoJaFechou, METRICS_FLUSH_SIZE,
    TIME_SERIES_BATCH_SIZE: LOTE, TIME_SERIES_ASSET_CONCURRENCY, formatPhaseTimes,
} =
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
        const assets = Array.from({ length: 8 * LOTE }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
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
        expect(gravadas).toBe(4 * LOTE); // 4 lotes concluídos antes do corte
    });

    it('cobertura incompleta é denunciada no log e gravada no SystemConfig', async () => {
        const assets = Array.from({ length: 4 * LOTE }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
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
        expect(stats.visited).toBe(2 * LOTE);
        expect(stats.total).toBe(4 * LOTE);
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

/**
 * O REGISTRO DE ESCALADA NÃO PODE ALARMAR POR PREGÃO EM ANDAMENTO.
 *
 * O reforço da B3 roda para toda série cuja ponta não alcança o último pregão. O
 * cron oficial é às 18:30, depois do fechamento das 17:30, e aí "não alcança"
 * significa mesmo buraco. Num `sync` manual às 15h significa outra coisa: o dia
 * ainda está acontecendo. Sem esta régua, aquela execução escreveria centenas de
 * linhas de "sem fechamento em fonte nenhuma" no painel — o alarme mais caro que
 * existe, o que está errado e parece certo.
 */
describe('sessaoJaFechou', () => {
  const asDate = (iso) => new Date(iso);

  it('pregão de ontem já fechou, a qualquer hora de hoje', () => {
    // 09:00 BRT de 04/09, perguntando pelo pregão de 03/09.
    expect(sessaoJaFechou('2026-09-03', asDate('2026-09-04T12:00:00.000Z'))).toBe(true);
  });

  it('durante o pregão de hoje, a sessão do dia ainda não fechou', () => {
    // 15:00 BRT (18:00Z) de 03/09, perguntando pelo pregão de 03/09.
    expect(sessaoJaFechou('2026-09-03', asDate('2026-09-03T18:00:00.000Z'))).toBe(false);
  });

  it('depois das 18h BRT, o fechamento do dia é cobrável', () => {
    // 18:30 BRT (21:30Z), o horário do cron oficial.
    expect(sessaoJaFechou('2026-09-03', asDate('2026-09-03T21:30:00.000Z'))).toBe(true);
  });
});

// 30/10/2026: o lote passou de 5 para 20 para pagar menos idas e voltas ao banco
// por ativo. O que não pode mudar com isso é a pressão na fonte.
describe('timeSeriesWorker.run — lote grande, fonte com a mesma pressão', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mocks.getBenchmarkHistory.mockResolvedValue([]);
        mocks.historyUpdateOne.mockResolvedValue({});
        mocks.historyUpdateMany.mockResolvedValue({});
        mocks.marketAssetBulkWrite.mockResolvedValue({});
        mocks.systemConfigUpdate.mockResolvedValue({});
        mocks.historyFind.mockReturnValue({ lean: async () => [] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const runWorker = async () => {
        const promise = timeSeriesWorker.run();
        await vi.runAllTimersAsync();
        await promise;
    };

    it('o Yahoo nunca vê mais que TIME_SERIES_ASSET_CONCURRENCY pedidos simultâneos', async () => {
        const assets = Array.from({ length: 2 * LOTE + 3 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        let emVoo = 0;
        let pico = 0;
        mocks.getFullHistory.mockImplementation(async () => {
            emVoo += 1;
            pico = Math.max(pico, emVoo);
            await new Promise((r) => setTimeout(r, 50));
            emVoo -= 1;
            return candles(40);
        });

        await runWorker();

        expect(mocks.getFullHistory).toHaveBeenCalledTimes(assets.length);
        expect(pico).toBe(TIME_SERIES_ASSET_CONCURRENCY);
        // Uma leitura de histórico por LOTE (mais a varredura de staleness), não por ativo.
        expect(mocks.historyFind).toHaveBeenCalledTimes(1 + Math.ceil(assets.length / LOTE));
    });

    it('o run termina dizendo onde o tempo foi', async () => {
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery([{ ticker: 'AT0', type: 'STOCK' }]));
        mocks.getFullHistory.mockResolvedValue(candles(40));

        await runWorker();

        // A pausa de cortesia de 1s ao Yahoo entra no relógio (timers falsos avançam).
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringMatching(/Tempo por fase: .*pausas 1s/), expect.objectContaining({ phaseMs: expect.any(Object) }));
    });
});

describe('formatPhaseTimes', () => {
    it('marca com Σ as fases paralelas e formata minutos', () => {
        expect(formatPhaseTimes({ leitura: 125_000, yahoo: 61_000, 'gravação': 3_000, pausas: 9_400 }))
            .toBe('leitura 2m05s · yahoo Σ 1m01s · gravação Σ 3s · pausas 9s');
    });

    it('esconde fase abaixo de 1s e não inventa fase que não rodou', () => {
        expect(formatPhaseTimes({ leitura: 400, visitas: 2_000 })).toBe('visitas 2s');
        expect(formatPhaseTimes({})).toBe('');
    });
});
