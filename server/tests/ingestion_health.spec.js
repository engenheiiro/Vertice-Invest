import { describe, expect, it } from 'vitest';
import {
    createFundamentusStats,
    finalizeFundamentusStats,
    validateFundamentusIngestion,
    validateFundamentalsPublicationHealth,
} from '../utils/ingestionHealth.js';

describe('health gate da ingestão Fundamentus', () => {
    it('aceita a distribuição observada com o layout corrigido', () => {
        const stats = createFundamentusStats({ stockParsed: 994, fiiParsed: 560 });
        stats.STOCK.accepted = 333;
        stats.STOCK.rejectedLowLiquidity = 661;
        stats.FII.accepted = 326;
        stats.FII.rejectedLowLiquidity = 234;

        const result = validateFundamentusIngestion(stats);
        expect(result.ok).toBe(true);
        expect(result.stats.STOCK.acceptanceRate).toBeCloseTo(333 / 994);
        expect(result.stats.FII.acceptanceRate).toBeCloseTo(326 / 560);
    });

    it('bloqueia a regressão real de 994 linhas para 3 aceitas', () => {
        const stats = createFundamentusStats({ stockParsed: 994, fiiParsed: 560 });
        stats.STOCK.accepted = 3;
        stats.STOCK.rejectedLowLiquidity = 991;
        stats.FII.accepted = 326;

        const result = validateFundamentusIngestion(stats);
        expect(result.ok).toBe(false);
        expect(result.code).toBe('FUNDAMENTUS_ACCEPTANCE_COLLAPSE');
        expect(result.reason).toContain('STOCK: 3/994');
    });

    it('bloqueia scrape parcial mesmo quando a outra classe está saudável', () => {
        const stats = createFundamentusStats({ stockParsed: 0, fiiParsed: 560 });
        stats.FII.accepted = 326;

        const result = validateFundamentusIngestion(stats);
        expect(result.ok).toBe(false);
        expect(result.code).toBe('FUNDAMENTUS_PARTIAL');
    });

    it('finaliza contadores sem NaN ou divisão por zero', () => {
        const stats = finalizeFundamentusStats(createFundamentusStats());
        expect(stats.STOCK.acceptanceRate).toBe(0);
        expect(stats.FII.acceptanceRate).toBe(0);
    });
});

describe('gate de publicação por saúde dos fundamentos', () => {
    const now = new Date('2026-07-19T20:00:00Z');
    const healthy = {
        fundamentalsHealthy: true,
        timestamp: new Date('2026-07-19T18:00:00Z'),
    };

    it('libera ranking BR com sync saudável e recente', () => {
        expect(validateFundamentalsPublicationHealth('STOCK', healthy, now).ok).toBe(true);
        expect(validateFundamentalsPublicationHealth('FII', healthy, now).ok).toBe(true);
        expect(validateFundamentalsPublicationHealth('BRASIL_10', healthy, now).ok).toBe(true);
    });

    it('bloqueia ranking BR após sync degradado ou ausente', () => {
        expect(validateFundamentalsPublicationHealth('STOCK', null, now).ok).toBe(false);
        expect(validateFundamentalsPublicationHealth('STOCK', {
            ...healthy,
            fundamentalsHealthy: false,
        }, now).ok).toBe(false);
    });

    it('bloqueia saúde velha e não interfere em classes não BR', () => {
        const stale = { fundamentalsHealthy: true, timestamp: new Date('2026-07-17T00:00:00Z') };
        expect(validateFundamentalsPublicationHealth('STOCK', stale, now).ok).toBe(false);
        expect(validateFundamentalsPublicationHealth('CRYPTO', null, now).ok).toBe(true);
    });
});
