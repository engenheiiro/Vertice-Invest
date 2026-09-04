import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A B3 como segunda fonte da série DIÁRIA — o que o universo de pesquisa não
 * tinha. O que se cobra aqui é a fronteira do reforço: até onde ele cobre, e onde
 * ele deve se recusar a agir para não prometer o que não pode entregar.
 */

const fetchB3DailyCloses = vi.fn();
vi.mock('../services/b3DailyFileService.js', () => ({ fetchB3DailyCloses: (...a) => fetchB3DailyCloses(...a) }));

const {
    collectB3Candles, isB3Coverable, lastBusinessDayUpTo, missingBusinessDays,
} = await import('../services/b3HistoryFallback.js');

beforeEach(() => vi.clearAllMocks());

const arquivo = (linhas) => new Map(Object.entries(linhas));

describe('cobertura da B3', () => {
    it('cobre ação, FII e ETF com ticker da bolsa brasileira', () => {
        expect(isB3Coverable('ITSA4', 'STOCK')).toBe(true);
        expect(isB3Coverable('KNCR11', 'FII')).toBe(true);
        expect(isB3Coverable('BOVA11', 'ETF')).toBe(true);
    });

    // O arquivo é do à vista da B3. Pedir AAPL ou BTC ali não é fallback, é engano:
    // devolveria vazio sempre e ainda gastaria um download de 8,5 MB para descobrir.
    it('não cobre ativo de fora da B3', () => {
        expect(isB3Coverable('AAPL', 'STOCK_US')).toBe(false);
        expect(isB3Coverable('VOO', 'ETF')).toBe(false);
        expect(isB3Coverable('BTC-USD', 'CRYPTO')).toBe(false);
        expect(isB3Coverable('PETR4', 'CRYPTO')).toBe(false);
    });
});

describe('janela de dias', () => {
    // 2026-09-04 é sexta.
    it('fim de semana olha para a sexta', () => {
        expect(lastBusinessDayUpTo('2026-09-05')).toBe('2026-09-04'); // sábado
        expect(lastBusinessDayUpTo('2026-09-06')).toBe('2026-09-04'); // domingo
        expect(lastBusinessDayUpTo('2026-09-04')).toBe('2026-09-04');
    });

    // Empurrar só o candle de hoje numa série parada há dias deixa o buraco no meio
    // E faz `isHistoryStale` ver a série como fresca — o worker nunca mais volta lá.
    it('devolve a lacuna INTEIRA, não só a ponta', () => {
        const dias = missingBusinessDays('2026-09-01', '2026-09-04');
        expect(dias).toEqual(['2026-09-02', '2026-09-03', '2026-09-04']);
    });

    it('série já na ponta não pede nada', () => {
        expect(missingBusinessDays('2026-09-04', '2026-09-04')).toEqual([]);
    });
});

describe('collectB3Candles', () => {
    it('baixa UM arquivo por dia, não um por ticker', async () => {
        fetchB3DailyCloses.mockResolvedValue(arquivo({
            ITSA4: { close: 12.84, volume: 100 },
            PETR4: { close: 42.7, volume: 200 },
            BOVA11: { close: 172.4, volume: 300 },
        }));

        const out = await collectB3Candles([
            { key: 'ITSA4', ticker: 'ITSA4', type: 'STOCK', lastCandleDate: '2026-09-03' },
            { key: 'PETR4', ticker: 'PETR4', type: 'STOCK', lastCandleDate: '2026-09-03' },
            { key: 'BOVA11', ticker: 'BOVA11', type: 'ETF', lastCandleDate: '2026-09-03' },
        ], '2026-09-04');

        expect(fetchB3DailyCloses).toHaveBeenCalledTimes(1);
        expect(out.get('ITSA4')).toEqual([{ date: '2026-09-04', close: 12.84, volume: 100 }]);
        expect(out.size).toBe(3);
    });

    // Ausente no arquivo = o papel não negociou naquele dia. Inventar um fechamento
    // seria pior que a lacuna: entraria na série como preço real.
    it('ticker ausente no arquivo não vira candle', async () => {
        fetchB3DailyCloses.mockResolvedValue(arquivo({ ITSA4: { close: 12.84, volume: 100 } }));
        const out = await collectB3Candles([
            { key: 'ILIQ11', ticker: 'ILIQ11', type: 'FII', lastCandleDate: '2026-09-03' },
        ], '2026-09-04');
        expect(out.size).toBe(0);
    });

    it('dia sem arquivo publicado não quebra nada', async () => {
        fetchB3DailyCloses.mockResolvedValue(null);
        const out = await collectB3Candles([
            { key: 'ITSA4', ticker: 'ITSA4', type: 'STOCK', lastCandleDate: '2026-09-03' },
        ], '2026-09-04');
        expect(out.size).toBe(0);
    });

    it('ativo fora da B3 nem chega a pedir o arquivo', async () => {
        const out = await collectB3Candles([
            { key: 'AAPL', ticker: 'AAPL', type: 'STOCK_US', lastCandleDate: '2026-09-03' },
        ], '2026-09-04');
        expect(fetchB3DailyCloses).not.toHaveBeenCalled();
        expect(out.size).toBe(0);
    });

    // Limite honesto do reforço: o arquivo é por pregão (~8,5 MB), então reconstruir
    // um ano custaria ~250 downloads. O teto impede que uma série muito atrasada
    // transforme um run em maratona de download.
    it('respeita o teto de dias por alvo', async () => {
        fetchB3DailyCloses.mockResolvedValue(arquivo({ ITSA4: { close: 12.84, volume: 100 } }));
        await collectB3Candles([
            { key: 'ITSA4', ticker: 'ITSA4', type: 'STOCK', lastCandleDate: '2026-01-02' },
        ], '2026-09-04', { maxDays: 3 });
        expect(fetchB3DailyCloses).toHaveBeenCalledTimes(3);
    });
});
