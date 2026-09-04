/**
 * O UNIVERSO DE PESQUISA GANHA SEGUNDA FONTE.
 *
 * Até aqui o `timeSeriesWorker` tinha fonte única: se o Yahoo não entregasse, a
 * série parava — e com ela SMA, RSI, beta, volatilidade e o backtest. O caminho da
 * carteira já tinha o fechamento oficial da B3 como reforço desde 31/08/2026; as
 * ~1.300 séries do universo, não.
 *
 * O modo de falha que motiva tudo NÃO é o Yahoo cair: é ele devolver a série
 * inteira MENOS o dia (661 séries da B3 em 28/08/2026). Aí `fetched` é verdadeiro,
 * o run se dá por satisfeito e o buraco fica — a série parece saudável e ninguém
 * volta lá. Por isso o reforço roda mesmo quando a busca principal "deu certo".
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
    fetchB3DailyCloses: vi.fn(),
}));

vi.mock('../models/MarketAsset.js', () => ({
    default: { find: mocks.marketAssetFind, bulkWrite: mocks.marketAssetBulkWrite },
}));
vi.mock('../models/AssetHistory.js', () => ({
    default: { find: mocks.historyFind, updateOne: mocks.historyUpdateOne, updateMany: mocks.historyUpdateMany },
}));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOneAndUpdate: mocks.systemConfigUpdate } }));
vi.mock('../services/externalMarketService.js', () => ({
    externalMarketService: { getFullHistory: mocks.getFullHistory },
}));
vi.mock('../services/marketDataService.js', () => ({
    marketDataService: { getBenchmarkHistory: mocks.getBenchmarkHistory },
}));
vi.mock('../services/b3DailyFileService.js', () => ({
    fetchB3DailyCloses: (...a) => mocks.fetchB3DailyCloses(...a),
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { timeSeriesWorker } = await import('../services/workers/timeSeriesWorker.js');

// 2026-09-04 é sexta; o worker roda "hoje" e cobra o candle desse pregão.
const HOJE = new Date('2026-09-04T21:30:00.000Z');
const PREGAO = '2026-09-04';
const VESPERA = '2026-09-03';

const candles = (n, lastDate) => {
    const end = new Date(`${lastDate}T00:00:00Z`).getTime();
    return Array.from({ length: n }, (_, i) => ({
        date: new Date(end - (n - 1 - i) * 86400000).toISOString().slice(0, 10),
        close: 100 + i,
        adjClose: 100 + i,
        volume: 1000,
    }));
};

const marketAssetQuery = (assets) => ({ select: () => ({ lean: async () => assets }) });
const historyQuery = (docs) => ({ lean: async () => docs });

/** Série de ITSA4 parada na véspera, como o banco a devolveria. */
const serieParada = () => [{ ticker: 'ITSA4', history: candles(40, VESPERA), lastCheckedAt: null }];

const prepara = (docs) => {
    mocks.marketAssetFind.mockReturnValue(marketAssetQuery([{ ticker: 'ITSA4', type: 'STOCK' }]));
    // 1ª chamada: fila de staleness (projeção enxuta). 2ª: histórico do lote.
    mocks.historyFind
        .mockReturnValueOnce(historyQuery(docs.map((d) => ({ ticker: d.ticker, lastCheckedAt: d.lastCheckedAt }))))
        .mockReturnValue(historyQuery(docs));
};

/** Candles gravados no AssetHistory por chamada de updateOne. */
const gravados = () => mocks.historyUpdateOne.mock.calls.map((c) => c[1].$set.history);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
    mocks.getBenchmarkHistory.mockResolvedValue([]);
    mocks.historyUpdateOne.mockResolvedValue({});
    mocks.historyUpdateMany.mockResolvedValue({});
    mocks.marketAssetBulkWrite.mockResolvedValue({});
    mocks.systemConfigUpdate.mockResolvedValue({});
    mocks.fetchB3DailyCloses.mockResolvedValue(new Map([['ITSA4', { close: 12.84, volume: 5000 }]]));
});

afterEach(() => vi.useRealTimers());

/** Executa o run adiantando os `setTimeout(1000)` de throttle entre lotes. */
const runWorker = async () => {
    const promise = timeSeriesWorker.run();
    await vi.runAllTimersAsync();
    return promise;
};

describe('timeSeriesWorker — reforço da B3', () => {
    it('fecha a ponta quando o Yahoo entrega a série SEM o dia', async () => {
        prepara(serieParada());
        // O caso de 28/08/2026: série completa até a véspera, dia publicado vazio.
        mocks.getFullHistory.mockResolvedValue(candles(40, VESPERA));

        await runWorker();

        expect(mocks.fetchB3DailyCloses).toHaveBeenCalledWith(PREGAO);
        const ultima = gravados().at(-1);
        expect(ultima.some((c) => c.date === PREGAO && c.close === 12.84)).toBe(true);
    });

    it('estende a série quando o Yahoo não devolve nada', async () => {
        prepara(serieParada());
        mocks.getFullHistory.mockResolvedValue(null);

        await runWorker();

        const ultima = gravados().at(-1);
        expect(ultima.some((c) => c.date === PREGAO && c.close === 12.84)).toBe(true);
    });

    it('não busca nada quando a série já alcança o pregão', async () => {
        prepara([{ ticker: 'ITSA4', history: candles(40, PREGAO), lastCheckedAt: null }]);
        mocks.getFullHistory.mockResolvedValue(candles(40, PREGAO));

        await runWorker();

        expect(mocks.fetchB3DailyCloses).not.toHaveBeenCalled();
    });

    // Limite honesto: o arquivo é por pregão, então reconstruir histórico custaria
    // centenas de downloads. A B3 estende a ponta de quem já tem série; quem não tem
    // continua dependendo do Yahoo — e a tela precisa dizer isso, não prometer mais.
    it('NÃO tenta reconstruir série vazia', async () => {
        prepara([{ ticker: 'ITSA4', history: [], lastCheckedAt: null }]);
        mocks.getFullHistory.mockResolvedValue(null);

        await runWorker();

        expect(mocks.fetchB3DailyCloses).not.toHaveBeenCalled();
    });

    it('ativo fora da B3 não passa pelo reforço', async () => {
        mocks.marketAssetFind.mockReturnValue(marketAssetQuery([{ ticker: 'AAPL', type: 'STOCK_US' }]));
        mocks.historyFind
            .mockReturnValueOnce(historyQuery([{ ticker: 'AAPL', lastCheckedAt: null }]))
            .mockReturnValue(historyQuery([{ ticker: 'AAPL', history: candles(40, VESPERA) }]));
        mocks.getFullHistory.mockResolvedValue(candles(40, VESPERA));

        await runWorker();

        expect(mocks.fetchB3DailyCloses).not.toHaveBeenCalled();
    });

    // Reforço que derruba o run deixa de ser reforço.
    it('falha da B3 não derruba o run', async () => {
        prepara(serieParada());
        mocks.getFullHistory.mockResolvedValue(candles(40, VESPERA));
        mocks.fetchB3DailyCloses.mockRejectedValue(new Error('ETIMEDOUT'));

        await expect(runWorker()).resolves.toBeUndefined();
        expect(mocks.systemConfigUpdate).toHaveBeenCalled();
    });

    it('registra quantas séries avançaram pela B3', async () => {
        prepara(serieParada());
        mocks.getFullHistory.mockResolvedValue(candles(40, VESPERA));

        await runWorker();

        const stats = mocks.systemConfigUpdate.mock.calls.at(-1)[1].$set.lastTimeSeriesStats;
        expect(stats.recoveredByB3).toBe(1);
    });
});
