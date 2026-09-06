/**
 * SÉRIE CURTA DEMAIS PARA MEDIR APAGA A MEDIDA VELHA.
 *
 * O worker sempre saiu calado quando a série tinha menos de 20 candles — sem
 * série não há SMA, então não havia o que gravar. O silêncio parece conservador
 * e não é: a métrica que fica no banco foi calculada sobre a série ANTERIOR, e
 * nada garante que aquela série ainda seja deste ativo.
 *
 * Medido em 06/09/2026 no TON. A correção do símbolo de cripto (`repairCryptoSymbols`)
 * apagou a série do impostor "TON Token"; o símbolo certo (`TON11419-USD`) publica
 * apenas 2 candles diários, então o worker voltou a sair calado a cada run — e a
 * SMA200 do impostor (0,0060) seguiu no banco encostada num preço de 1,42. O
 * scoring lê `m.sma200 > 0` como "temos tendência" e enxergava o ativo 236x acima
 * dela, aplicando penalidade de esticado sobre um número de outro token.
 *
 * Zero é o vocabulário que o resto do sistema já usa para ausente, então limpar é
 * a mesma régua de "métrica inaplicável = ausente" que vale no scoring.
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
    repairCryptoCandleGaps: vi.fn(),
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
vi.mock('../services/b3DailyFileService.js', () => ({ fetchB3DailyCloses: (...a) => mocks.fetchB3DailyCloses(...a) }));
vi.mock('../services/cryptoCandleRepairService.js', () => ({
    repairCryptoCandleGaps: (...a) => mocks.repairCryptoCandleGaps(...a),
}));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { timeSeriesWorker } = await import('../services/workers/timeSeriesWorker.js');

const HOJE = new Date('2026-09-06T21:30:00.000Z');

const candles = (n, lastDate) => {
    const end = new Date(`${lastDate}T00:00:00Z`).getTime();
    return Array.from({ length: n }, (_, i) => ({
        date: new Date(end - (n - 1 - i) * 86400000).toISOString().slice(0, 10),
        close: 1 + i / 100,
        adjClose: 1 + i / 100,
        volume: 1000,
    }));
};

const prepara = (asset, history) => {
    mocks.marketAssetFind.mockReturnValue({ select: () => ({ lean: async () => [asset] }) });
    const key = asset.type === 'CRYPTO' ? `${asset.ticker}-USD` : asset.ticker;
    const docs = [{ ticker: key, history, lastCheckedAt: null }];
    mocks.historyFind
        .mockReturnValueOnce({ lean: async () => docs.map((d) => ({ ticker: d.ticker, lastCheckedAt: d.lastCheckedAt })) })
        .mockReturnValue({ lean: async () => docs });
};

/** $set gravado no MarketAsset para um ticker, através do bulkWrite de métricas. */
const metricasDe = (ticker) => mocks.marketAssetBulkWrite.mock.calls
    .flatMap(([ops]) => ops || [])
    .filter((op) => op.updateOne?.filter?.ticker === ticker)
    .map((op) => op.updateOne.update.$set);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);
    mocks.getBenchmarkHistory.mockResolvedValue([]);
    mocks.historyUpdateOne.mockResolvedValue({});
    mocks.historyUpdateMany.mockResolvedValue({});
    mocks.marketAssetBulkWrite.mockResolvedValue({});
    mocks.systemConfigUpdate.mockResolvedValue({});
    mocks.fetchB3DailyCloses.mockResolvedValue(new Map());
    mocks.repairCryptoCandleGaps.mockResolvedValue({});
});

afterEach(() => vi.useRealTimers());

const runWorker = async () => {
    const promise = timeSeriesWorker.run();
    await vi.runAllTimersAsync();
    return promise;
};

describe('timeSeriesWorker — série curta demais para medir', () => {
    it('zera SMA200, EMA50 e volatilidade em vez de deixar a medida do dono anterior da série', async () => {
        // O TON depois da troca de símbolo: a fonte certa só tem 2 candles.
        prepara({ ticker: 'TON', type: 'CRYPTO' }, candles(2, '2026-09-05'));
        mocks.getFullHistory.mockResolvedValue(candles(2, '2026-09-05'));

        await runWorker();

        expect(metricasDe('TON')).toEqual([{ sma200: 0, ema50: 0, volatility: 0 }]);
    });

    it('não toca no beta — para cripto/US ele vem do sync de fundamentos, não daqui', async () => {
        prepara({ ticker: 'TON', type: 'CRYPTO' }, candles(2, '2026-09-05'));
        mocks.getFullHistory.mockResolvedValue(candles(2, '2026-09-05'));

        await runWorker();

        expect(metricasDe('TON')[0]).not.toHaveProperty('beta');
    });

    it('série com fôlego continua sendo medida normalmente', async () => {
        prepara({ ticker: 'ETH', type: 'CRYPTO' }, candles(60, '2026-09-05'));
        mocks.getFullHistory.mockResolvedValue(candles(60, '2026-09-05'));

        await runWorker();

        const [set] = metricasDe('ETH');
        // 60 candles não alcançam a SMA200 (que é 0 = ausente por conta própria),
        // mas EMA50 e volatilidade saem — é medida de verdade, não limpeza.
        expect(set.ema50).toBeGreaterThan(0);
        expect(set.volatility).toBeGreaterThan(0);
    });
});
