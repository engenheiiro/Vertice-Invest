/**
 * PR6 — Scoring dedicado por sub-tipo de Exterior (ETF / REIT / Ouro).
 *
 * Garante que ativos sem fundamentos de empresa (P/L, ROE) NÃO são capados
 * injustamente em 70 pelo modelo de ação, e que cada sub-tipo é pontuado pelas
 * métricas aplicáveis (liquidez, yield, tendência, volatilidade) — sem NaN.
 */
import { describe, it, expect } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

const CTX = { MACRO: { SELIC: 10.5, IPCA: 4.0, RISK_FREE: 10.5, NTNB_LONG: 6.4 } };

// Base de um fundo do Exterior: sem P/L, ROE, margem (todos ausentes), mas líquido.
const makeFund = (usSubType, overrides = {}) => ({
    ticker: 'FUND',
    type: 'STOCK_US',
    name: 'Fundo Teste',
    sector: 'ETF',
    usSubType,
    fiiSubType: null,
    price: 100,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'FUND',
        price: 100,
        pl: 0, pvp: 0, roe: 0, roic: 0, netMargin: 0, evEbitda: 0,
        revenueGrowth: 0, debtToEquity: 0, netDebt: 0, payout: 0,
        dy: 3.2,
        marketCap: 0,
        avgLiquidity: 80000000, // ETF bem líquido
        vacancy: 0, capRate: 0, qtdImoveis: 0,
        volatility: 15,
        beta: 1.0,
        sma200: 90, // preço (100) acima da média → tendência de alta
        ema50: 95,
        sector: 'ETF',
        fiiSubType: null,
        _missing: { pl: true, marketCap: true, roe: true, netMargin: true, revenueGrowth: true, evEbitda: true, beta: false, dy: false, debtToEquity: false, payout: false },
        _staleDays: 10,
        dataCompleteness: 20,
        structural: { quality: 50, valuation: 50, risk: 50 },
        ...(overrides.metrics || {}),
    },
    ...overrides,
});

const noNaN = (res) => {
    const s = res.scores;
    for (const k of ['DEFENSIVE', 'MODERATE', 'BOLD']) expect(Number.isFinite(s[k])).toBe(true);
    const st = res.metrics.structural;
    for (const k of ['quality', 'valuation', 'risk']) expect(Number.isFinite(st[k])).toBe(true);
};

describe('scoringEngine — Exterior por sub-tipo', () => {
    it('ETF sem P/L/ROE NÃO é capado em 70 (cesta líquida em tendência de alta)', () => {
        const res = scoringEngine.processAsset(makeFund('ETF'), CTX);
        expect(res._discarded).toBeFalsy();
        // Confiança não é punida por fundamentos de empresa ausentes → teto pode passar de 70.
        expect(res.scores.MODERATE).toBeGreaterThan(70);
        noNaN(res);
    });

    it('ETF não recebe método Graham/Bazin de empresa (preço justo = mercado)', () => {
        const res = scoringEngine.processAsset(makeFund('ETF'), CTX);
        expect(res.metrics.method).toBe('Mercado');
        expect(res.targetPrice).toBe(100);
    });

    it('REIT é pontuado por dividend yield (yield alto eleva o score)', () => {
        const low = scoringEngine.processAsset(makeFund('REIT', { metrics: { dy: 1.0 } }), CTX);
        const high = scoringEngine.processAsset(makeFund('REIT', { metrics: { dy: 6.0 } }), CTX);
        expect(high.scores.MODERATE).toBeGreaterThan(low.scores.MODERATE);
        noNaN(low); noNaN(high);
    });

    it('Ouro recebe score defensivo estável e não é descartado', () => {
        const res = scoringEngine.processAsset(makeFund('GOLD', { ticker: 'GLD', metrics: { dy: 0 } }), CTX);
        expect(res._discarded).toBeFalsy();
        expect(res.scores.DEFENSIVE).toBeGreaterThanOrEqual(60);
        // Ouro não tem yield: arrojado < defensivo (sem prêmio de risco).
        expect(res.scores.BOLD).toBeLessThan(res.scores.DEFENSIVE);
        noNaN(res);
    });

    it('Ouro em tendência de baixa pontua menos que em alta (momentum)', () => {
        const up = scoringEngine.processAsset(makeFund('GOLD', { ticker: 'GLD', price: 100, metrics: { sma200: 90, dy: 0 } }), CTX);
        const down = scoringEngine.processAsset(makeFund('GOLD', { ticker: 'GLD', price: 100, metrics: { sma200: 120, dy: 0 } }), CTX);
        expect(up.scores.MODERATE).toBeGreaterThan(down.scores.MODERATE);
    });

    it('ETF NACIONAL (type ETF, classe própria) usa o caminho de ETF: não capado em 70, preço justo = mercado', () => {
        // Classe própria (BR, BRL): sem usSubType; deve cair no mesmo modelo de ETF do Exterior.
        const national = { ...makeFund('ETF'), type: 'ETF', usSubType: null, ticker: 'BOVA11', currency: 'BRL' };
        const res = scoringEngine.processAsset(national, CTX);
        expect(res._discarded).toBeFalsy();
        expect(res.scores.MODERATE).toBeGreaterThan(70);
        expect(res.metrics.method).toBe('Mercado');
        expect(res.targetPrice).toBe(100);
        noNaN(res);
    });
});

// Roteamento por TEMA do ETF nacional: Cripto/Ouro/Renda Fixa NÃO são cesta de ações e
// ganham scorers próprios (com guardrails apropriados), em vez do modelo genérico.
const makeBrEtf = (sector, overrides = {}) => ({
    ...makeFund('ETF'),
    type: 'ETF',
    usSubType: null,
    currency: 'BRL',
    sector,
    ...overrides,
    metrics: { ...makeFund('ETF').metrics, sector, ...(overrides.metrics || {}) },
});

describe('scoringEngine — ETF nacional por tema (Cripto/Ouro/Renda Fixa)', () => {
    it('ETF de CRIPTO (HASH11) é rotulado como tema único, não "cesta diversificada"', () => {
        const res = scoringEngine.processAsset(
            makeBrEtf('Cripto', { ticker: 'HASH11', metrics: { volatility: 60, dy: 0 } }), CTX);
        expect(res._discarded).toBeFalsy();
        const labels = res.auditLog.map(a => a.factor).join(' | ');
        expect(labels).toMatch(/ETF Cripto|Base ETF Cripto/);
        expect(labels).not.toMatch(/cesta diversificada/);
        noNaN(res);
    });

    it('ETF de CRIPTO respeita o teto especulativo no BOLD (≤ 80)', () => {
        const res = scoringEngine.processAsset(
            makeBrEtf('Cripto', { ticker: 'BITH11', price: 100, metrics: { volatility: 30, sma200: 70, dy: 0, avgLiquidity: 80000000 } }), CTX);
        expect(res.scores.BOLD).toBeLessThanOrEqual(80);
        noNaN(res);
    });

    it('ETF de OURO (GOLD11) recebe tratamento de hedge (defensivo forte, arrojado menor)', () => {
        const res = scoringEngine.processAsset(
            makeBrEtf('Ouro', { ticker: 'GOLD11', metrics: { volatility: 15, dy: 0 } }), CTX);
        expect(res._discarded).toBeFalsy();
        expect(res.scores.DEFENSIVE).toBeGreaterThanOrEqual(60);
        expect(res.scores.BOLD).toBeLessThan(res.scores.DEFENSIVE);
        noNaN(res);
    });

    it('ETF de RENDA FIXA (FIXA11) é defensivo e não pontua alto no arrojado', () => {
        const res = scoringEngine.processAsset(
            makeBrEtf('Renda Fixa', { ticker: 'FIXA11', metrics: { volatility: 8, dy: 10 } }), CTX);
        expect(res._discarded).toBeFalsy();
        expect(res.scores.DEFENSIVE).toBeGreaterThan(res.scores.BOLD);
        noNaN(res);
    });

    it('ETF de índice amplo (BOVA11) permanece na cesta diversificada genérica', () => {
        const res = scoringEngine.processAsset(
            makeBrEtf('Índice Amplo', { ticker: 'BOVA11', metrics: { dy: 4.5 } }), CTX);
        const labels = res.auditLog.map(a => a.factor).join(' | ');
        expect(labels).toMatch(/cesta diversificada/);
        noNaN(res);
    });
});
