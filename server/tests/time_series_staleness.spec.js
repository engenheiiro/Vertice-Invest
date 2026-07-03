/**
 * isHistoryStale — staleness pela data do último candle (jul/2026).
 * O critério antigo (lastUpdated > 7d) era derrotado pelo "touch" diário que
 * renovava lastUpdated sem re-buscar candles: a série congelava para sempre
 * (confirmado em produção: BTC parado 3+ semanas com lastUpdated fresco).
 * O helper ignora lastUpdated e julga pela idade do candle mais recente.
 */
import { describe, it, expect } from 'vitest';
import { isHistoryStale, HISTORY_MAX_CANDLE_AGE_DAYS } from '../services/workers/timeSeriesWorker.js';

const NOW = new Date('2026-07-03T18:30:00Z');
const daysAgo = (n) => {
    const d = new Date(NOW.getTime() - n * 86400000);
    return d.toISOString().slice(0, 10);
};
const entry = (dates, lastUpdated = NOW) => ({
    ticker: 'TEST',
    lastUpdated,
    history: dates.map(date => ({ date, close: 100, adjClose: 100 })),
});

describe('isHistoryStale', () => {
    it('candle de ontem (~1,8d à noite) → fresco', () => {
        expect(isHistoryStale(entry([daysAgo(10), daysAgo(1)]), NOW)).toBe(false);
    });

    it('candle de anteontem (~2,8d à noite) → stale (re-busca a cada ~2 dias)', () => {
        expect(isHistoryStale(entry([daysAgo(HISTORY_MAX_CANDLE_AGE_DAYS)]), NOW)).toBe(true);
    });

    it('fim de semana: sábado à noite com candle de sexta → fresco (sem busca inútil)', () => {
        const saturdayNight = new Date('2026-07-04T21:00:00Z'); // sábado
        expect(isHistoryStale(entry(['2026-07-03']), saturdayNight)).toBe(false);
    });

    it('REGRESSÃO do bug: lastUpdated fresco NÃO salva série congelada (caso BTC)', () => {
        // lastUpdated renovado hoje pelo touch, mas o último candle tem 24 dias.
        const frozen = entry([daysAgo(30), daysAgo(24)], NOW);
        expect(isHistoryStale(frozen, NOW)).toBe(true);
    });

    it('não assume ordenação: acha o candle mais recente no meio do array', () => {
        expect(isHistoryStale(entry([daysAgo(20), daysAgo(1), daysAgo(10)]), NOW)).toBe(false);
    });

    it('entry nulo, sem history ou vazio → stale (força busca)', () => {
        expect(isHistoryStale(null, NOW)).toBe(true);
        expect(isHistoryStale({ ticker: 'X' }, NOW)).toBe(true);
        expect(isHistoryStale(entry([]), NOW)).toBe(true);
    });

    it('candles sem date válida → stale', () => {
        expect(isHistoryStale({ history: [{ close: 10 }] }, NOW)).toBe(true);
    });
});
