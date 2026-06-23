/**
 * Fase 1 — Refinamentos de baixo risco do sistema de rankings.
 * Cobre os achados D, F, G e I da análise (ANALISE_RANKINGS_VERTICE_2026-06.txt).
 * Validação score-neutral do H está coberta indiretamente por scoring_parity/quant_regression.
 */
import { describe, it, expect } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

const CTX = { MACRO: { SELIC: 14.75, IPCA: 4.62, RISK_FREE: 14.75, NTNB_LONG: 6.3 } };
const CTX_STALE = { MACRO: { ...CTX.MACRO, RATES_STALE: true } };

const factorsOf = (res, category) =>
    res.auditLog.filter(a => !category || a.category === category).map(a => a.factor);

// --- D: gate de papel de FII não veta FII de papel por qtdImoveis<2 -----------
const makePaperFii = (overrides = {}) => ({
    ticker: 'PAPL11',
    type: 'FII',
    name: 'FII Recebíveis Teste',
    sector: 'Recebíveis Imobiliários', // rótulo SEM a palavra "Papel"
    fiiSubType: 'PAPEL',
    price: 100,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'PAPL11', price: 100, pl: 0, pvp: 0.98, roe: 0, netMargin: 0,
        evEbitda: 0, revenueGrowth: 0, debtToEquity: 0, payout: 0, dy: 12,
        marketCap: 1500000000, avgLiquidity: 4000000, vacancy: 0, capRate: 0,
        qtdImoveis: 0, // FII de papel não tem imóveis
        volatility: 10, beta: 0.3, sector: 'Recebíveis Imobiliários', fiiSubType: 'PAPEL',
        _missing: { roe: true, netMargin: true, revenueGrowth: true, marketCap: false },
        _staleDays: 15,
    },
    ...overrides,
});

describe('Fase 1 — D: FII de papel não é vetado do Defensivo por falta de imóveis', () => {
    it('FII de papel (qtdImoveis=0, setor "Recebíveis" sem "Papel") é ELEGÍVEL ao Defensivo', () => {
        const res = scoringEngine.processAsset(makePaperFii(), CTX);
        expect(res._discarded).toBeUndefined();
        const factors = factorsOf(res, 'Perfil Defensivo');
        // Eligível → recebe a base "Score Base (FII Defensivo)" (40), NÃO o marcador de inelegível.
        expect(factors).toContain('Score Base (FII Defensivo)');
        expect(factors).not.toContain('Ineligível para Carteira Defensiva FII');
        // Base 40 + bônus de yield/PVP/beta → bem acima do piso de inelegível (25).
        expect(res.scores.DEFENSIVE).toBeGreaterThan(25);
    });

    it('FII de TIJOLO mono-ativo (qtdImoveis<2) continua vetado do Defensivo (base inelegível 25)', () => {
        const monoTijolo = makePaperFii({
            sector: 'Lajes Corporativas', fiiSubType: 'TIJOLO',
            metrics: { ...makePaperFii().metrics, sector: 'Lajes Corporativas', fiiSubType: 'TIJOLO', qtdImoveis: 1 },
        });
        const res = scoringEngine.processAsset(monoTijolo, CTX);
        expect(factorsOf(res, 'Perfil Defensivo')).toContain('Ineligível para Carteira Defensiva FII');
        expect(res.scores.DEFENSIVE).toBe(25);
    });
});

// --- F: ETF com avgLiquidity=0 (fonte não reportou) não sofre penalidade -------
const makeEtf = (overrides = {}) => ({
    ticker: 'BOVA11',
    type: 'ETF',
    name: 'ETF Teste',
    sector: 'Índice Amplo',
    fiiSubType: null,
    price: 120,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'BOVA11', price: 120, pl: 0, pvp: 0, roe: 0, netMargin: 0,
        evEbitda: 0, revenueGrowth: 0, debtToEquity: 0, payout: 0, dy: 0,
        marketCap: 0, avgLiquidity: 0, vacancy: 0, capRate: 0, qtdImoveis: 0,
        volatility: 16, beta: 1.0, sma200: 110, ema50: 115,
        sector: 'Índice Amplo', fiiSubType: null,
        _missing: {}, _staleDays: 10,
    },
    ...overrides,
});

describe('Fase 1 — F: ETF com liquidez não reportada (0) não é penalizado por liquidez', () => {
    it('avgLiquidity=0 NÃO gera penalidade "Liquidez Baixa" e registra nota informativa', () => {
        const res = scoringEngine.processAsset(makeEtf(), CTX);
        const factors = factorsOf(res);
        expect(factors.some(f => f.includes('Liquidez Baixa'))).toBe(false);
        expect(factors.some(f => f.includes('não reportada'))).toBe(true);
    });

    it('ETF com liquidez baixa REAL (>0 e <1M) continua penalizado', () => {
        const lowLiq = makeEtf({ metrics: { ...makeEtf().metrics, avgLiquidity: 500000 } });
        const res = scoringEngine.processAsset(lowLiq, CTX);
        expect(factorsOf(res).some(f => f.includes('Liquidez Baixa'))).toBe(true);
    });
});

// --- G: SMA200 ausente vira nota no auditLog (não degrada em silêncio) ---------
describe('Fase 1 — G: SMA200 ausente é registrado no auditLog', () => {
    const makeStock = (sma200) => ({
        ticker: 'TEST3', type: 'STOCK', name: 'Empresa Teste', sector: 'Energia Elétrica',
        fiiSubType: null, price: 40, dbFlags: { isBlacklisted: false, isTier1: false },
        metrics: {
            ticker: 'TEST3', price: 40, pl: 12, pvp: 1.8, roe: 18, roic: 15, netMargin: 22,
            evEbitda: 7, revenueGrowth: 12, debtToEquity: 0.8, netDebt: 500000000, payout: 55,
            dy: 7.5, marketCap: 15000000000, avgLiquidity: 3000000, vacancy: 0, capRate: 0,
            qtdImoveis: 0, volatility: 28, beta: 0.85, sma200, ema50: 39,
            sector: 'Energia Elétrica', fiiSubType: null,
            _missing: { pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false, evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false },
            _staleDays: 30,
        },
    });

    it('sma200=0 produz nota "SMA200) indisponível" e NÃO produz nota com sma200 presente', () => {
        const semSma = scoringEngine.processAsset(makeStock(0), CTX);
        const comSma = scoringEngine.processAsset(makeStock(38), CTX);
        expect(factorsOf(semSma).some(f => f.includes('SMA200) indisponível'))).toBe(true);
        expect(factorsOf(comSma).some(f => f.includes('SMA200) indisponível'))).toBe(false);
    });
});

// --- I: macro defasado (ratesStale) desconta confiança de BR (STOCK/FII) -------
describe('Fase 1 — I: macro defasado desconta confiança de ativos BR', () => {
    const makeStock = () => ({
        ticker: 'TEST3', type: 'STOCK', name: 'Empresa Teste', sector: 'Energia Elétrica',
        fiiSubType: null, price: 40, dbFlags: { isBlacklisted: false, isTier1: false },
        metrics: {
            ticker: 'TEST3', price: 40, pl: 12, pvp: 1.8, roe: 18, roic: 15, netMargin: 22,
            evEbitda: 7, revenueGrowth: 12, debtToEquity: 0.8, netDebt: 500000000, payout: 55,
            dy: 7.5, marketCap: 15000000000, avgLiquidity: 3000000, vacancy: 0, capRate: 0,
            qtdImoveis: 0, volatility: 28, beta: 0.85, sma200: 38, ema50: 39,
            sector: 'Energia Elétrica', fiiSubType: null,
            _missing: { pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false, evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false },
            _staleDays: 30,
        },
    });

    it('STOCK BR com ratesStale ganha nota de confiança e score ≤ ao macro fresco', () => {
        const fresh = scoringEngine.processAsset(makeStock(), CTX);
        const stale = scoringEngine.processAsset(makeStock(), CTX_STALE);
        expect(factorsOf(stale, 'Dados e Confiança').some(f => f.includes('Macro Defasados'))).toBe(true);
        expect(factorsOf(fresh, 'Dados e Confiança').some(f => f.includes('Macro Defasados'))).toBe(false);
        expect(stale.scores.DEFENSIVE).toBeLessThanOrEqual(fresh.scores.DEFENSIVE);
    });

    it('CRYPTO não é afetado por ratesStale (não usa taxas BR)', () => {
        const crypto = {
            ticker: 'BTC', type: 'CRYPTO', name: 'Bitcoin', sector: 'Crypto', fiiSubType: null,
            price: 300000, dbFlags: { isBlacklisted: false, isTier1: true },
            metrics: {
                ticker: 'BTC', price: 300000, marketCap: 1200000000000, avgLiquidity: 30000000000,
                volatility: 45, beta: 1.2, sma200: 250000, dy: 0,
                _missing: {}, _staleDays: 0,
            },
        };
        const fresh = scoringEngine.processAsset(crypto, CTX);
        const stale = scoringEngine.processAsset(crypto, CTX_STALE);
        expect(stale.scores.BOLD).toBe(fresh.scores.BOLD);
    });
});
