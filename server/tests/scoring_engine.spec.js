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

// FII saudável e líquido, com dado-base completo (patrimônio presente).
const makeFii = (overrides = {}) => ({
    ticker: 'TEST11',
    type: 'FII',
    name: 'FII Teste',
    sector: 'Logística',
    fiiSubType: 'TIJOLO',
    price: 100,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'TEST11', price: 100, pl: 0, pvp: 0.92, roe: 0, netMargin: 0,
        evEbitda: 0, revenueGrowth: 0, debtToEquity: 0, payout: 0, dy: 11,
        marketCap: 2000000000, avgLiquidity: 5000000, vacancy: 3, capRate: 9,
        qtdImoveis: 25, volatility: 12, beta: 0.4, sector: 'Logística', fiiSubType: 'TIJOLO',
        // FIIs não têm essas métricas de empresa — estruturalmente ausentes.
        _missing: { roe: true, netMargin: true, revenueGrowth: true, marketCap: false },
        _staleDays: 20,
    },
    ...overrides,
});

describe('scoringEngine — confiança de FII (anti-compressão em 85)', () => {
    it('FII com dados aplicáveis completos NÃO é teto-limitado em 85 (pode exceder)', () => {
        const res = scoringEngine.processAsset(makeFii(), DEFAULT_CONTEXT);
        expect(res._discarded).toBeUndefined();
        const best = Math.max(res.scores.DEFENSIVE, res.scores.MODERATE, res.scores.BOLD);
        // Antes do fix, revenueGrowth/roe ausentes derrubavam a confiança a 60 → teto 85.
        expect(best).toBeGreaterThan(85);
    });

    it('não credita "Crescimento/Rentabilidade Ausentes" na confiança de FII (inaplicável)', () => {
        const res = scoringEngine.processAsset(makeFii(), DEFAULT_CONTEXT);
        const conf = res.auditLog.filter(a => a.category === 'Dados e Confiança').map(a => a.factor);
        expect(conf).not.toContain('Dados de Crescimento Ausentes');
        expect(conf).not.toContain('Dados de Rentabilidade Ausentes');
    });

    it('ações continuam penalizadas por dados de empresa ausentes (teto preservado)', () => {
        const stock = makeStock({
            metrics: {
                ...makeStock().metrics,
                _missing: { revenueGrowth: true, roe: true, netMargin: true, payout: false, marketCap: false },
            },
        });
        const res = scoringEngine.processAsset(stock, DEFAULT_CONTEXT);
        const conf = res.auditLog.filter(a => a.category === 'Dados e Confiança').map(a => a.factor);
        expect(conf).toContain('Dados de Crescimento Ausentes');
        // confidence 60 → teto 85 para ação com dados de empresa faltando
        expect(Math.max(res.scores.DEFENSIVE, res.scores.MODERATE, res.scores.BOLD)).toBeLessThanOrEqual(85);
    });
});

describe('scoringEngine — teto de confiança registrado no auditLog', () => {
    // Quando o teto graduado (maxScoreAllowed < 100) de fato reduz o score do perfil,
    // a dedução precisa aparecer no auditLog para a Auditoria Completa reconciliar.
    it('FII com confiança <60 (liquidez <1M + dados muito stale) capa o score e grava o fator de teto', () => {
        // -30 (liquidez <1M) -30 (stale >180d) → confiança 40 → maxScoreAllowed 70.
        const fii = makeFii({ metrics: { ...makeFii().metrics, avgLiquidity: 900000, _staleDays: 200 } });
        const res = scoringEngine.processAsset(fii, DEFAULT_CONTEXT);
        expect(res._discarded).toBeUndefined();
        const best = Math.max(res.scores.DEFENSIVE, res.scores.MODERATE, res.scores.BOLD);
        expect(best).toBeLessThanOrEqual(70);
        const capEntries = res.auditLog.filter(a => a.factor.startsWith('Teto por Confiança'));
        expect(capEntries.length).toBeGreaterThan(0);
        expect(capEntries.every(a => a.points < 0 && a.type === 'penalty')).toBe(true);
    });

    it('ativo com dados completos (teto 100) NÃO recebe fator de teto de confiança', () => {
        const res = scoringEngine.processAsset(makeFii(), DEFAULT_CONTEXT);
        const capEntries = res.auditLog.filter(a => a.factor.startsWith('Teto por Confiança'));
        expect(capEntries.length).toBe(0);
    });
});

describe('scoringEngine — guarda de tendência de baixa (anti value-trap)', () => {
    // Mesma ação, variando só o desvio preço×SMA200. Em downtrend forte deve perder
    // pontos de perfil (e cair para WAIT); em uptrend não recebe penalidade.
    const trendStock = (price, sma200) => makeStock({
        metrics: { ...makeStock().metrics, sma200, ema50: sma200, price },
        price,
    });

    it('penaliza ação barata em downtrend severo (>25% abaixo da SMA200)', () => {
        const up = scoringEngine.processAsset(trendStock(40, 38), DEFAULT_CONTEXT);     // +5% acima
        const down = scoringEngine.processAsset(trendStock(28, 40), DEFAULT_CONTEXT);   // -30% abaixo
        expect(down.scores.MODERATE).toBeLessThan(up.scores.MODERATE);
        const factors = down.auditLog.map(a => a.factor);
        expect(factors.some(f => f.includes('Tendência de Baixa'))).toBe(true);
    });

    it('NÃO penaliza ação em tendência de alta (preço acima da SMA200)', () => {
        const res = scoringEngine.processAsset(trendStock(45, 38), DEFAULT_CONTEXT);
        const factors = res.auditLog.map(a => a.factor);
        expect(factors.some(f => f.includes('Tendência de Baixa'))).toBe(false);
    });

    it('downtrend leve (<8% abaixo) não dispara penalidade', () => {
        const res = scoringEngine.processAsset(trendStock(37, 39), DEFAULT_CONTEXT); // -5%
        const factors = res.auditLog.map(a => a.factor);
        expect(factors.some(f => f.includes('Tendência de Baixa'))).toBe(false);
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
