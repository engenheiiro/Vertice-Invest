/**
 * Brasil 10 — geração determinística (sem draft competitivo).
 * Cobre getTop5Defensive (extração top-5 por score DEFENSIVO) e buildBrasil10
 * (merge ≤5 STOCK + ≤5 FII, reaplicação do threshold, ordenação e posição).
 * Funções puras exportadas de aiResearchService.
 */
import { describe, it, expect } from 'vitest';
import { getTop5Defensive, buildBrasil10 } from '../services/aiResearchService.js';

const mk = (ticker, type, def) => ({
    ticker,
    type,
    sector: type === 'FII' ? 'Logística' : 'Bancos',
    scores: { DEFENSIVE: def, MODERATE: def - 5, BOLD: def - 10 },
    metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
});

describe('getTop5Defensive', () => {
    it('pega o top 5 por score DEFENSIVO e força o perfil DEFENSIVE', () => {
        const assets = [90, 85, 80, 75, 70, 65, 60].map((d, i) => mk(`S${i}3`, 'STOCK', d));
        const top = getTop5Defensive(assets);
        expect(top.length).toBe(5);
        expect(top.map((a) => a.score)).toEqual([90, 85, 80, 75, 70]);
        expect(top.every((a) => a.riskProfile === 'DEFENSIVE')).toBe(true);
    });

    it('usa o score DEFENSIVO (não o melhor perfil) para ordenar', () => {
        // BOLD seria maior, mas Brasil 10 é sempre defensivo.
        const assets = [
            { ticker: 'X3', type: 'STOCK', sector: 'Bancos', scores: { DEFENSIVE: 50, MODERATE: 90, BOLD: 95 }, metrics: { structural: { quality: 60, valuation: 60, risk: 60 } } },
            mk('Y3', 'STOCK', 60),
        ];
        const top = getTop5Defensive(assets);
        expect(top[0].ticker).toBe('Y3'); // 60 def > 50 def
        expect(top[0].score).toBe(60);
    });

    it('lida com universo com menos de 5 ativos', () => {
        const assets = [80, 70].map((d, i) => mk(`S${i}3`, 'STOCK', d));
        expect(getTop5Defensive(assets).length).toBe(2);
    });

    it('entrada vazia/nula retorna []', () => {
        expect(getTop5Defensive([])).toEqual([]);
        expect(getTop5Defensive(undefined)).toEqual([]);
    });
});

describe('buildBrasil10', () => {
    const stocks = [92, 88, 84, 80, 76, 50].map((d, i) => mk(`S${i}3`, 'STOCK', d));
    const fiis = [95, 72, 68, 66, 40, 30].map((d, i) => mk(`F${i}11`, 'FII', d));

    it('monta 5 STOCK + 5 FII e ordena por score desc', () => {
        const list = buildBrasil10(stocks, fiis);
        expect(list.length).toBe(10);
        expect(list.filter((a) => a.type === 'STOCK').length).toBe(5);
        expect(list.filter((a) => a.type === 'FII').length).toBe(5);
        const scores = list.map((a) => a.score);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('todos DEFENSIVE e action segue exatamente o threshold 70', () => {
        const list = buildBrasil10(stocks, fiis);
        expect(list.every((a) => a.riskProfile === 'DEFENSIVE')).toBe(true);
        expect(list.every((a) => a.action === (a.score >= 70 ? 'BUY' : 'WAIT'))).toBe(true);
    });

    it('posições contíguas 1..N e sem ticker duplicado', () => {
        const list = buildBrasil10(stocks, fiis);
        expect(list.map((a) => a.position)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
        expect(new Set(list.map((a) => a.ticker)).size).toBe(10);
    });

    it('com poucos ativos numa classe, não força 10 (≤5+≤5)', () => {
        const list = buildBrasil10(stocks.slice(0, 2), fiis.slice(0, 3));
        expect(list.length).toBe(5);
        expect(list.filter((a) => a.type === 'STOCK').length).toBe(2);
        expect(list.filter((a) => a.type === 'FII').length).toBe(3);
    });
});
