/**
 * T1 — Testes unitários do scoringEngine (gates de descarte + saída base).
 * Foca nos critérios de corte determinísticos de processAsset() e na forma
 * da saída para um ativo saudável (scores por perfil, auditLog, structural).
 */
import { describe, it, expect } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

const DEFAULT_CONTEXT = {
    MACRO: { SELIC: 13.75, IPCA: 4.62, RISK_FREE: 13.75, NTNB_LONG: 6.4 },
};

// Ativo STOCK saudável (passa em todos os gates de elegibilidade).
const makeStock = (overrides = {}) => ({
    ticker: 'TEST3',
    type: 'STOCK',
    name: 'Empresa Teste',
    sector: 'Energia Elétrica',
    fiiSubType: null,
    price: 40.0,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'TEST3',
        price: 40.0,
        pl: 12,
        pvp: 1.8,
        roe: 18,
        roic: 15,
        netMargin: 22,
        evEbitda: 7,
        revenueGrowth: 12,
        debtToEquity: 0.8,
        netDebt: 500000000,
        payout: 55,
        dy: 7.5,
        marketCap: 15000000000,
        avgLiquidity: 3000000,
        vacancy: 0,
        capRate: 0,
        qtdImoveis: 0,
        volatility: 28,
        beta: 0.85,
        sma200: 38,
        ema50: 39,
        sector: 'Energia Elétrica',
        fiiSubType: null,
        _missing: {
            pl: false, marketCap: false, roe: false, netMargin: false,
            revenueGrowth: false, evEbitda: false, beta: false, dy: false,
            debtToEquity: false, payout: false,
        },
        _staleDays: 30,
        dataCompleteness: 100,
        structural: { quality: 50, valuation: 50, risk: 50 },
    },
    ...overrides,
});

describe('scoringEngine.processAsset — gates de descarte', () => {
    it('descarta stablecoin (CRYPTO pareado)', () => {
        const res = scoringEngine.processAsset(
            { ticker: 'USDT', type: 'CRYPTO', price: 1, metrics: { avgLiquidity: 1e9 } },
            DEFAULT_CONTEXT
        );
        expect(res._discarded).toBe(true);
        expect(res.reason).toBe('Stablecoin');
    });

    it('descarta ação de preço de centavos (price <= 0.01)', () => {
        const res = scoringEngine.processAsset(makeStock({ price: 0.005 }), DEFAULT_CONTEXT);
        expect(res._discarded).toBe(true);
        expect(res.reason).toBe('Preço de Centavos');
    });

    it('descarta STOCK com liquidez abaixo do piso (200k)', () => {
        const asset = makeStock({ metrics: { ...makeStock().metrics, avgLiquidity: 100000 } });
        const res = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(res._discarded).toBe(true);
        expect(res.reason).toBe('Liquidez Insuficiente');
    });

    it('descarta FII com liquidez abaixo do piso (500k)', () => {
        const res = scoringEngine.processAsset(
            { ticker: 'XPTO11', type: 'FII', price: 100, metrics: { avgLiquidity: 400000 } },
            DEFAULT_CONTEXT
        );
        expect(res._discarded).toBe(true);
        expect(res.reason).toBe('Liquidez Insuficiente');
    });

    it('descarta ativo em blacklist manual', () => {
        const res = scoringEngine.processAsset(
            makeStock({ dbFlags: { isBlacklisted: true } }),
            DEFAULT_CONTEXT
        );
        expect(res._discarded).toBe(true);
        expect(res.reason).toBe('Blacklist Manual');
    });
});

describe('scoringEngine.processAsset — saída de ativo saudável', () => {
    it('não descarta e produz scores por perfil + auditLog + structural', () => {
        const res = scoringEngine.processAsset(makeStock(), DEFAULT_CONTEXT);

        expect(res._discarded).toBeUndefined();
        expect(res.ticker).toBe('TEST3');

        // Três perfis de risco, todos 0–100
        for (const profile of ['DEFENSIVE', 'MODERATE', 'BOLD']) {
            expect(typeof res.scores[profile]).toBe('number');
            expect(res.scores[profile]).toBeGreaterThanOrEqual(0);
            expect(res.scores[profile]).toBeLessThanOrEqual(100);
        }

        // Scores estruturais presentes
        expect(res.metrics.structural).toBeTruthy();
        expect(typeof res.metrics.structural.quality).toBe('number');

        // AuditLog é um array não-vazio
        expect(Array.isArray(res.auditLog)).toBe(true);
        expect(res.auditLog.length).toBeGreaterThan(0);
    });
});
