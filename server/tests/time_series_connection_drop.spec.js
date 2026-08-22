/**
 * QUEDA DE CONEXÃO NO MEIO DO RUN DO timeSeriesWorker.
 *
 * Em 22/08/2026 o `sync:prod` levou 18m40s e a etapa de séries temporais morreu
 * em 570/1300 ativos com:
 *   `Socket 'secureConnect' timed out after 30214ms (connectTimeoutMS: 30000)`
 * O pool precisou abrir um socket novo no meio de um laço de 13 minutos e o
 * handshake TLS não fechou a tempo. Um único flap de 30s custou 730 ativos com
 * beta, volatilidade, SMA e EMA velhos — dado que alimenta o portão do ranking
 * e do buyAndHoldEngine — e apagou o ganho do commit 330d07e (defasagem de
 * séries de 66,8% para 2,1%).
 *
 * O comportamento exigido aqui:
 *   1. queda transitória NÃO zera as métricas já coletadas;
 *   2. queda transitória NÃO aborta o run — o lote é pulado e a fila continua;
 *   3. o lote pulado não renova `lastCheckedAt` (volta à cabeça da fila amanhã);
 *   4. banco realmente fora (N lotes seguidos) ainda encerra o run, com flush;
 *   5. erro que NÃO é de transporte continua fatal na hora.
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

const { timeSeriesWorker, MAX_CONSECUTIVE_BATCH_FAILURES } =
    await import('../services/workers/timeSeriesWorker.js');
const logger = (await import('../config/logger.js')).default;

const BATCH_SIZE = 5; // espelha o worker

const candles = (n, lastDate = '2026-08-21') => {
    const end = new Date(`${lastDate}T00:00:00Z`).getTime();
    return Array.from({ length: n }, (_, i) => ({
        date: new Date(end - (n - 1 - i) * 86400000).toISOString().slice(0, 10),
        close: 100 + i,
        adjClose: 100 + i,
        volume: 1000,
    }));
};

const marketAssetQuery = (assets) => ({ select: () => ({ lean: async () => assets }) });

/** O erro exato do run de 22/08/2026. */
const connectionDrop = () => {
    const err = new Error("Socket 'secureConnect' timed out after 30214ms (connectTimeoutMS: 30000)");
    err.name = 'MongoNetworkTimeoutError';
    return err;
};

const metricsWritten = () => mocks.marketAssetBulkWrite.mock.calls
    .reduce((sum, [ops]) => sum + ops.length, 0);

const tickersWritten = () => mocks.marketAssetBulkWrite.mock.calls
    .flatMap(([ops]) => ops.map(o => o.updateOne.filter.ticker));

describe('timeSeriesWorker — tolerância a queda de conexão', () => {
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

    const runWorker = async () => {
        const promise = timeSeriesWorker.run();
        await vi.runAllTimersAsync();
        await promise;
    };

    /** Tickers do lote de índice `idx` (0-based) numa fila AT0..ATn em ordem. */
    const loteDe = (idx) => Array.from({ length: BATCH_SIZE }, (_, k) => `AT${idx * BATCH_SIZE + k}`);

    /**
     * Derruba a conexão para lotes específicos, identificados pelos TICKERS que
     * a query pede — e não pela ordem da chamada. Assim as re-tentativas do
     * MESMO lote também caem, que é o que caracteriza um flap real; contar
     * chamadas faria a 2ª tentativa passar e o teste não provaria nada.
     * `times` limita quantas tentativas caem (para simular o blip que se cura).
     */
    const derrubaConexaoPara = (tickers, { times = Infinity } = {}) => {
        const alvo = new Set(tickers);
        let restantes = times;
        mocks.historyFind.mockImplementation((filter) => {
            const pedidos = filter?.ticker?.$in;
            if (pedidos && restantes > 0 && pedidos.some((t) => alvo.has(t))) {
                restantes -= 1;
                throw connectionDrop();
            }
            return { lean: async () => [] };
        });
    };

    it('flap no meio do laço NÃO zera as métricas já coletadas nem aborta o run', async () => {
        // 40 ativos = 8 lotes de 5. A conexão pisca no 4º lote (índice 3).
        const assets = Array.from({ length: 40 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        derrubaConexaoPara(loteDe(3));

        await runWorker();

        // Antes deste fix o run morria no 4º lote com 15 ativos gravados. Agora só
        // o lote do flap se perde: 35 dos 40 chegam ao banco.
        expect(metricsWritten()).toBe(35);
        expect(tickersWritten()).not.toContain('AT15'); // 1º do lote pulado
        expect(tickersWritten()).toContain('AT20');     // lote seguinte seguiu normal
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('o lote pulado não renova lastCheckedAt — volta à cabeça da fila no próximo run', async () => {
        const assets = Array.from({ length: 15 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        // O caminho normal renovaria lastCheckedAt do lote inteiro no updateMany.
        derrubaConexaoPara(loteDe(1));

        await runWorker();

        const tocados = mocks.historyUpdateMany.mock.calls.flatMap(([f]) => f.ticker.$in);
        for (const perdido of ['AT5', 'AT6', 'AT7', 'AT8', 'AT9']) {
            expect(tocados).not.toContain(perdido);
        }
    });

    it('a cobertura incompleta declara quantos ativos a queda custou', async () => {
        const assets = Array.from({ length: 20 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        derrubaConexaoPara(loteDe(2));

        await runWorker();

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('5 pulados em 1 lote(s) com queda de conexão'));
        const stats = mocks.systemConfigUpdate.mock.calls.at(-1)[1].$set.lastTimeSeriesStats;
        expect(stats).toMatchObject({ complete: false, visited: 15, total: 20, batchesFailed: 1, skipped: 5 });
    });

    it('quedas ESPAÇADAS não somam: o contador zera a cada lote que passa', async () => {
        // 3 quedas isoladas > MAX-1, mas nunca consecutivas → o run vai até o fim.
        const assets = Array.from({ length: 50 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        derrubaConexaoPara([...loteDe(1), ...loteDe(4), ...loteDe(7)]);

        await runWorker();

        expect(metricsWritten()).toBe(50 - 3 * BATCH_SIZE);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('banco realmente fora encerra o run — mas só após N lotes seguidos, com flush', async () => {
        const assets = Array.from({ length: 100 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        // Cai a partir do 3º lote e não volta mais (AT10 em diante).
        derrubaConexaoPara(assets.slice(10).map((a) => a.ticker));

        await runWorker();

        // Os 2 lotes bons antes da queda foram gravados (flush do caminho de erro).
        expect(metricsWritten()).toBe(10);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Erro após'));
        const stats = mocks.systemConfigUpdate.mock.calls.at(-1)[1].$set.lastTimeSeriesStats;
        expect(stats.batchesFailed).toBe(MAX_CONSECUTIVE_BATCH_FAILURES);
        expect(stats.complete).toBe(false);
    });

    it('a operação do lote se recupera sozinha de um blip — sem perder o lote', async () => {
        const assets = Array.from({ length: 10 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        // O 2º lote cai UMA vez; o withMongoRetry re-tenta e passa.
        derrubaConexaoPara(loteDe(1), { times: 1 });

        await runWorker();

        expect(metricsWritten()).toBe(10); // nenhum ativo perdido
        const stats = mocks.systemConfigUpdate.mock.calls.at(-1)[1].$set.lastTimeSeriesStats;
        expect(stats).toMatchObject({ complete: true, batchesFailed: 0, skipped: 0 });
    });

    it('queda ao GRAVAR candles não é confundida com falha da fonte', async () => {
        const assets = Array.from({ length: 10 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        mocks.historyFind.mockReturnValue({ lean: async () => [] });
        // A fonte responde; quem cai é a gravação dos candles do 1º lote.
        const alvo = new Set(loteDe(0));
        mocks.historyUpdateOne.mockImplementation(async (filter) => {
            if (alvo.has(filter.ticker)) throw connectionDrop();
            return {};
        });

        await runWorker();

        const stats = mocks.systemConfigUpdate.mock.calls.at(-1)[1].$set.lastTimeSeriesStats;
        // Antes: o catch da fonte engolia a queda e os 5 viravam "sem dado na
        // fonte" (failed), escondendo o problema de banco. Agora é lote perdido.
        expect(stats.failed).toBe(0);
        expect(stats).toMatchObject({ batchesFailed: 1, skipped: 5 });
        expect(logger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('Falha ao buscar histórico para AT0'));
    });

    it('erro que NÃO é de conexão continua fatal na hora — sem re-tentar o defeito', async () => {
        const assets = Array.from({ length: 40 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        let call = -1;
        mocks.historyFind.mockImplementation(() => {
            if (call++ === 2) {
                const err = new TypeError("Cannot read properties of undefined (reading 'close')");
                throw err;
            }
            return { lean: async () => [] };
        });

        await runWorker();

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Erro após'));
        const stats = mocks.systemConfigUpdate.mock.calls.at(-1)[1].$set.lastTimeSeriesStats;
        expect(stats.batchesFailed).toBe(0); // não contou como queda de conexão
        expect(stats.visited).toBe(10);      // abortou no 3º lote, como antes
    });

    it('queda no flush não descarta as métricas — elas vão no flush seguinte', async () => {
        const assets = Array.from({ length: 10 }, (_, i) => ({ ticker: `AT${i}`, type: 'STOCK' }));
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery(assets));
        mocks.historyFind.mockReturnValue({ lean: async () => [] });
        // Falha em TODAS as re-tentativas do primeiro flush; o segundo passa.
        let flushes = 0;
        mocks.marketAssetBulkWrite.mockImplementation(async () => {
            if (flushes++ < 4) throw connectionDrop();
            return {};
        });
        // Força um flush no meio: o 2º lote cai, e o catch tenta gravar o que já há.
        derrubaConexaoPara(loteDe(1));

        await runWorker();

        // Os 5 ativos do 1º lote sobreviveram ao flush que falhou.
        expect(tickersWritten()).toEqual(expect.arrayContaining(['AT0', 'AT1', 'AT2', 'AT3', 'AT4']));
    });
});
