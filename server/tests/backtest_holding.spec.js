/**
 * Backtest de precisão — regra "enquanto publicado".
 * resolveHolding mede o retorno de um pick SÓ enquanto ele permaneceu no ranking
 * publicado: ao ser omitido por um ranking mais novo, o pick é rotacionado para
 * fora (não imputa quedas pós-saída ao algoritmo) e registra a DATA de saída para
 * casar o benchmark. Se nunca sai, o caller marca a preço de hoje (exited:false).
 */
import { describe, it, expect } from 'vitest';
import { resolveHolding } from '../scripts/runBacktestEngine.js';

// Cesta de um ranking publicado posterior: { date, ranking: [{ticker, currentPrice}] }.
const basket = (date, ...pairs) => ({
    date,
    ranking: pairs.map(([ticker, currentPrice]) => ({ ticker, currentPrice })),
});

describe('resolveHolding', () => {
    it('sem rankings posteriores → ainda publicado (caller marca a preço de hoje)', () => {
        const res = resolveHolding(100, 'PETR4', []);
        expect(res).toEqual({ exited: false, exitPrice: null, exitDate: null });
    });

    it('presente em todos os rankings seguintes → ainda publicado', () => {
        const later = [basket('2026-06-01', ['PETR4', 110]), basket('2026-06-10', ['PETR4', 120], ['VALE3', 50])];
        const res = resolveHolding(100, 'PETR4', later);
        expect(res).toEqual({ exited: false, exitPrice: null, exitDate: null });
    });

    it('omitido por um ranking mais novo → sai no último preço, na data daquele ranking', () => {
        const later = [basket('2026-06-01', ['PETR4', 110]), basket('2026-06-10', ['VALE3', 50])];
        const res = resolveHolding(100, 'PETR4', later);
        expect(res.exited).toBe(true);
        expect(res.exitPrice).toBe(110);
        expect(res.exitDate).toEqual(new Date('2026-06-10'));
    });

    it('sai já no 1º ranking seguinte → saída no preço de entrada', () => {
        const later = [basket('2026-06-05', ['VALE3', 50])];
        const res = resolveHolding(100, 'PETR4', later);
        expect(res.exited).toBe(true);
        expect(res.exitPrice).toBe(100);
        expect(res.exitDate).toEqual(new Date('2026-06-05'));
    });

    it('preço inválido (<=0) no ranking conta como saída', () => {
        const later = [basket('2026-06-07', ['PETR4', 0])];
        const res = resolveHolding(100, 'PETR4', later);
        expect(res.exited).toBe(true);
        expect(res.exitPrice).toBe(100);
    });

    it('rola o último preço por vários rankings antes de sair', () => {
        const later = [
            basket('2026-06-01', ['PETR4', 105]),
            basket('2026-06-08', ['PETR4', 130]),
            basket('2026-06-15', ['VALE3', 50]),
        ];
        const res = resolveHolding(100, 'PETR4', later);
        expect(res.exited).toBe(true);
        expect(res.exitPrice).toBe(130);
        expect(res.exitDate).toEqual(new Date('2026-06-15'));
    });
});
