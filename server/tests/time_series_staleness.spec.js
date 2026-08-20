/**
 * isHistoryStale — staleness pela data do último candle (jul/2026).
 * O critério antigo (lastUpdated > 7d) era derrotado pelo "touch" diário que
 * renovava lastUpdated sem re-buscar candles: a série congelava para sempre
 * (confirmado em produção: BTC parado 3+ semanas com lastUpdated fresco).
 * O helper ignora lastUpdated e julga pela idade do candle mais recente.
 */
import { describe, it, expect } from 'vitest';
import { isHistoryStale, HISTORY_MAX_CANDLE_AGE_DAYS } from '../services/workers/timeSeriesWorker.js';
import {
    buildCandleClock,
    candleDaysStale,
    summarizeCandleStaleness,
} from '../utils/candleStaleness.js';

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

/**
 * Sentinela de saúde — atraso do último CANDLE por coorte.
 *
 * A regra do painel media `AssetHistory.lastUpdated` (quando o worker BUSCOU)
 * contra um corte de 168h e, por isso, não enxergou a defasagem real de 20/08/2026:
 * 910 de ~1.264 ativos parados em 17/08, nenhum ETF com candle de 19/08 — tudo com
 * lastUpdated da mesma manhã. É o mesmo erro que `isHistoryStale` já havia corrigido
 * dentro do worker, repetido do lado de fora.
 */
describe('candleDaysStale (sentinela de saúde)', () => {
    // 20/08/2026 é quinta-feira; 17/08 é a segunda daquela semana.
    const THU = new Date('2026-08-20T15:00:00Z');
    const clock = buildCandleClock(THU);

    it('REGRESSÃO: fetch de hoje com candle de 3 dias atrás é atraso, não frescor', () => {
        // Caso BOVA11/VALE3 em 20/08/2026 — lastUpdated não entra na conta.
        expect(candleDaysStale('2026-08-17', 'STOCK', clock)).toBe(3); // 18, 19, 20
        expect(candleDaysStale('2026-08-18', 'ETF', clock)).toBe(2);   // 19, 20
    });

    it('candle de ontem é o piso saudável do dia — o de hoje só existe após o fechamento', () => {
        expect(candleDaysStale('2026-08-19', 'STOCK', clock)).toBe(1);
        expect(candleDaysStale('2026-08-20', 'STOCK', clock)).toBe(0);
    });

    it('fim de semana NÃO alarma a B3: sábado com candle de sexta = 0 dia útil', () => {
        const saturday = buildCandleClock(new Date('2026-08-22T15:00:00Z'));
        expect(candleDaysStale('2026-08-21', 'STOCK', saturday)).toBe(0);
        // Segunda de manhã, ainda com o candle da sexta: 1 dia útil, dentro do piso.
        const monday = buildCandleClock(new Date('2026-08-24T11:00:00Z'));
        expect(candleDaysStale('2026-08-21', 'FII', monday)).toBe(1);
    });

    it('feriado não conta como pregão perdido', () => {
        // 07/09/2026 (Independência) cai numa segunda: na terça, o candle de sexta
        // (04/09) tem 1 dia útil de atraso, não 2.
        const tuesday = buildCandleClock(new Date('2026-09-08T11:00:00Z'));
        expect(candleDaysStale('2026-09-04', 'STOCK', tuesday)).toBe(1);
    });

    it('cripto é medida em dias CORRIDOS — negocia 24/7 e tem candle no sábado', () => {
        const monday = buildCandleClock(new Date('2026-08-24T11:00:00Z'));
        // Régua de dia útil diria 1 (só a segunda) e a série pareceria em dia;
        // em dias corridos são 3, que é a verdade: perdeu sábado e domingo.
        expect(candleDaysStale('2026-08-21', 'CRYPTO', monday)).toBe(3);
        expect(candleDaysStale('2026-08-23', 'CRYPTO', monday)).toBe(1);
    });

    it('série ausente devolve o teto da escala (pior que qualquer limiar)', () => {
        expect(candleDaysStale(null, 'STOCK', clock)).toBe(clock.businessDays.length);
        expect(candleDaysStale(null, 'CRYPTO', clock)).toBe(clock.calendarDays.length);
        expect(candleDaysStale('2018-09-13', 'ETF', clock)).toBe(clock.businessDays.length);
    });
});

describe('summarizeCandleStaleness', () => {
    const THU = new Date('2026-08-20T15:00:00Z');
    const clock = buildCandleClock(THU);
    const candles = new Map([
        ['PETR4', '2026-08-19'],
        ['VALE3', '2026-08-17'],
        ['BOVA11', '2026-08-18'],
        ['BTC-USD', '2026-08-20'],
        // Séries legitimamente mortas, que existem na base de verdade.
        ['SMAL', '2018-09-13'],
        ['MATIC', '2025-03-24'],
        ['MERC4', '2026-04-10'],
    ]);

    it('conta só quem passou da tolerância, e nomeia os piores primeiro', () => {
        const cohort = [
            { ticker: 'PETR4', type: 'STOCK' },
            { ticker: 'VALE3', type: 'STOCK' },
            { ticker: 'BOVA11', type: 'ETF' },
            { ticker: 'BTC', type: 'CRYPTO' },
        ];
        const summary = summarizeCandleStaleness(cohort, candles, clock, 2);
        expect(summary.total).toBe(4);
        expect(summary.stale).toBe(2); // VALE3 (3) e BOVA11 (2)
        expect(summary.worst.map((s) => s.ticker)).toEqual(['VALE3', 'BOVA11']);
        expect(summary.worst[0].lastCandle).toBe('2026-08-17');
    });

    it('cripto usa a régua corrida dentro da mesma coorte', () => {
        const monday = buildCandleClock(new Date('2026-08-24T11:00:00Z'));
        const cohort = [{ ticker: 'BTC', type: 'CRYPTO' }, { ticker: 'PETR4', type: 'STOCK' }];
        const summary = summarizeCandleStaleness(
            cohort,
            new Map([['BTC-USD', '2026-08-21'], ['PETR4', '2026-08-21']]),
            monday,
            2,
        );
        // Mesma data de último candle: a ação está em dia (1 dia útil), a cripto não (3 corridos).
        expect(summary.stale).toBe(1);
        expect(summary.worst[0].ticker).toBe('BTC');
    });

    it('ativo morto fora da coorte NÃO entra na conta, mesmo tendo série guardada', () => {
        // SMAL (2018), MATIC (cripto que saiu da fonte) e MERC4 (deslistada) seguem
        // em AssetHistory. Varrer a coleção faria o alarme nascer vermelho para
        // sempre; quem manda é a coorte.
        const summary = summarizeCandleStaleness([{ ticker: 'PETR4', type: 'STOCK' }], candles, clock, 3);
        expect(summary.total).toBe(1);
        expect(summary.stale).toBe(0);
    });

    it('ativo da coorte sem série nenhuma conta como parado (fail-closed)', () => {
        const summary = summarizeCandleStaleness(
            [{ ticker: 'NOVO11', type: 'FII' }], candles, clock, 3,
        );
        expect(summary.stale).toBe(1);
        expect(summary.worst[0].lastCandle).toBeNull();
    });

    it('agrupa a concentração por data — falha de cobertura para todas no mesmo dia', () => {
        const cohort = [
            { ticker: 'VALE3', type: 'STOCK' },
            { ticker: 'SBSP3', type: 'STOCK' },
            { ticker: 'BOVA11', type: 'ETF' },
        ];
        const summary = summarizeCandleStaleness(
            cohort,
            new Map([['VALE3', '2026-08-17'], ['SBSP3', '2026-08-17'], ['BOVA11', '2026-08-18']]),
            clock,
            2,
        );
        expect(summary.dates[0]).toEqual({ date: '2026-08-17', count: 2 });
    });

    it('não conta o mesmo ticker duas vezes (posições em carteiras diferentes)', () => {
        const cohort = [{ ticker: 'PETR4', type: 'STOCK' }, { ticker: 'PETR4', type: 'STOCK' }];
        expect(summarizeCandleStaleness(cohort, candles, clock, 2).total).toBe(1);
    });
});
