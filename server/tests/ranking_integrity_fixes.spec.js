/**
 * Correções de integridade do ranking (auditoria 11/2026):
 *  1. gate DEFENSIVE com beta ausente (gravado como 0) passava — agora reprova;
 *  2. rota "DY ≥ 6% + P/L ≤ 10" aceitava P/L ≤ 0; ROE ausente passava no Defensivo;
 *  3. calibração de ações capava só pela própria confiança (100 para BANK etc.);
 *  6. BUY_THRESHOLD fixo em 70, sem override por env;
 *  7. melhor perfil da Auditoria Completa: empate determinístico e sem "BOLD 0";
 *  8. RSI de série plana é 50 (neutro), não 100.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));
vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { scoringEngine } = await import('../services/engines/scoringEngine.js');
const { calculateStockCalibrationConfidence } = await import('../services/engines/stockSectorAxisEngine.js');
const { composeCohesiveShadowScore } = await import('../services/engines/stockCalibrationShadowEngine.js');
const { signalEngine } = await import('../services/engines/signalEngine.js');
const { STOCK_ARCHETYPES } = await import('../config/stockCalibration.js');

const CONTEXT = { MACRO: { SELIC: 13.75, IPCA: 4.62, RISK_FREE: 13.75, NTNB_LONG: 6.4 } };

const makeStock = (metricOverrides = {}, assetOverrides = {}) => ({
    ticker: 'TEST3',
    type: 'STOCK',
    name: 'Empresa Teste',
    sector: 'Energia Elétrica',
    price: 40,
    dbFlags: { isBlacklisted: false },
    metrics: {
        pl: 12, pvp: 1.8, roe: 18, roic: 15, netMargin: 22, evEbitda: 7, revenueGrowth: 12,
        debtToEquity: 0.8, payout: 55, dy: 7.5, marketCap: 15e9, avgLiquidity: 3e6,
        volatility: 28, beta: 0.85, sma200: 38, ema50: 39,
        _missing: {
            pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false,
            evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false,
        },
        _staleDays: 30,
        ...metricOverrides,
    },
    ...assetOverrides,
});

const eligible = (asset) => scoringEngine.processAsset(asset, CONTEXT).isDefensiveEligible;

describe('Fix 1 — beta ausente reprova o DEFENSIVE (fail-closed)', () => {
    it('controle: ação saudável com beta medido é elegível', () => {
        expect(eligible(makeStock())).toBe(true);
    });

    it('beta 0 marcado como ausente reprova', () => {
        const m = makeStock().metrics;
        expect(eligible(makeStock({ beta: 0, _missing: { ...m._missing, beta: true } }))).toBe(false);
    });

    it('beta não finito reprova', () => {
        expect(eligible(makeStock({ beta: undefined }))).toBe(false);
        expect(eligible(makeStock({ beta: Number.NaN }))).toBe(false);
    });

    it('beta negativo REAL continua aceito', () => {
        expect(eligible(makeStock({ beta: -0.2 }))).toBe(true);
    });

    it('STOCK_US: beta ausente reprova', () => {
        const us = (metrics) => makeStock(
            { marketCap: 50e9, avgLiquidity: 50e6, ...metrics },
            { ticker: 'KO', type: 'STOCK_US', sector: 'Consumer Staples', usSubType: 'STOCK' },
        );
        expect(eligible(us({}))).toBe(true);
        const m = makeStock().metrics;
        expect(eligible(us({ beta: 0, _missing: { ...m._missing, beta: true } }))).toBe(false);
    });
});

describe('Fix 2 — P/L precisa ser positivo e ROE ausente reprova', () => {
    // Setor fora da lista segura → entra pela rota "DY ≥ 6% + P/L ≤ 10".
    const nonSafe = (metrics) => makeStock({ dy: 8, pl: 8, ...metrics }, { sector: 'Comércio Varejista' });

    it('controle: setor não seguro com DY 8% e P/L 8 é elegível', () => {
        expect(eligible(nonSafe({}))).toBe(true);
    });

    it('P/L 0 (ausente) reprova', () => {
        expect(eligible(nonSafe({ pl: 0 }))).toBe(false);
    });

    it('P/L negativo (prejuízo) reprova', () => {
        expect(eligible(nonSafe({ pl: -4 }))).toBe(false);
    });

    it('ROE ausente reprova o Defensivo', () => {
        const m = makeStock().metrics;
        expect(eligible(makeStock({ roe: 0, _missing: { ...m._missing, roe: true } }))).toBe(false);
    });
});

describe('Fix 3 — teto da calibração pela MENOR confiança', () => {
    const bankAsset = {
        ticker: 'BANK4',
        sector: 'Bancos',
        metrics: { avgLiquidity: 5e6, _staleDays: 200, _missing: { revenueGrowth: true, roe: true } },
    };
    const coverage = { archetype: STOCK_ARCHETYPES.BANK, requiredCoverage: 100 };

    it('sem a confiança legada, banco com dado stale/ausente ainda tira 100 (comportamento da calibração)', () => {
        expect(calculateStockCalibrationConfidence(bankAsset, coverage, false)).toBe(100);
    });

    it('com a confiança legada, vale a menor', () => {
        expect(calculateStockCalibrationConfidence(bankAsset, coverage, false, 40)).toBe(40);
        expect(calculateStockCalibrationConfidence(bankAsset, coverage, false, 100)).toBe(100);
    });

    it('confiança legada inválida é ignorada (não derruba para 0)', () => {
        expect(calculateStockCalibrationConfidence(bankAsset, coverage, false, null)).toBe(100);
        expect(calculateStockCalibrationConfidence(bankAsset, coverage, false, 'x')).toBe(100);
    });

    it('score composto que passaria de 70 fica capado em 70 (WAIT) com confiança < 60', () => {
        const base = { profile: 'DEFENSIVE', durability: 100, entry: 100, resilience: 100, baselineScore: 70 };
        expect(composeCohesiveShadowScore({ ...base, dataConfidence: 100 }).score).toBeGreaterThanOrEqual(74);
        const capped = composeCohesiveShadowScore({ ...base, dataConfidence: 40 });
        expect(capped.score).toBe(70);
    });

    it('processAsset expõe a confiança legada (dataConfidence)', () => {
        const res = scoringEngine.processAsset(makeStock({ _staleDays: 200 }), CONTEXT);
        expect(res.dataConfidence).toBe(70);
        expect(scoringEngine.processAsset(makeStock(), CONTEXT).dataConfidence).toBe(100);
    });
});

describe('Fix 6 — BUY_THRESHOLD fixo em 70', () => {
    it('ignora BUY_THRESHOLD do ambiente', async () => {
        const previous = process.env.BUY_THRESHOLD;
        process.env.BUY_THRESHOLD = '55';
        vi.resetModules();
        try {
            const { BUY_THRESHOLD } = await import('../config/financialConstants.js');
            expect(BUY_THRESHOLD).toBe(70);
        } finally {
            if (previous === undefined) delete process.env.BUY_THRESHOLD;
            else process.env.BUY_THRESHOLD = previous;
        }
    });
});

describe('Fix 8 — RSI de série plana é neutro', () => {
    it('série constante devolve 50', () => {
        expect(signalEngine.calculateRSI(Array(15).fill(10), 14)).toBe(50);
    });

    it('só altas continua 100', () => {
        // Mais recente primeiro: preços caindo para trás = só altas.
        const rising = Array.from({ length: 15 }, (_, i) => 30 - i);
        expect(signalEngine.calculateRSI(rising, 14)).toBe(100);
    });
});
