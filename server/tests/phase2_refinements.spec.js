/**
 * Fase 2 — Reequilíbrio do Defensivo e variância de cripto.
 * Cobre os achados A1, C, K e E da análise (ANALISE_RANKINGS_VERTICE_2026-06.txt §2.10).
 *   A1 — peso do upside no DEFENSIVO reduzido (+15/+10/+5/+3 → +8/+5/+3/+0).
 *   C  — tripla contagem de DY atenuada como consequência de A1 (sem novo número).
 *   K  — sobrepreço de growth caro (sem âncora Graham/Bazin) vira penalidade graduada.
 *   E  — volatilidade/SMA200 entram no score de perfil de cripto + trava branda no BOLD.
 */
import { describe, it, expect } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

const CTX = { MACRO: { SELIC: 14.75, IPCA: 4.62, RISK_FREE: 14.75, NTNB_LONG: 6.3 } };

const auditFor = (res, profile) =>
    res.auditLog.filter(a => a.category === profile);
const factorPoints = (res, profile, needle) => {
    const hit = auditFor(res, profile).find(a => a.factor.includes(needle));
    return hit ? hit.points : undefined;
};

// ── A1 ─────────────────────────────────────────────────────────────────────
// Ação defensiva-elegível com upside alto: o bônus de upside no DEFENSIVO deve
// valer no máximo +8 (antes +15). Construímos uma ação barata (preço bem abaixo
// do preço justo Bazin/Graham) e setor seguro para passar no gate.
const makeCheapDefensive = (overrides = {}) => ({
    ticker: 'CHEAP3', type: 'STOCK', name: 'Cíclica Barata', sector: 'Energia Elétrica',
    fiiSubType: null, price: 20, dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'CHEAP3', price: 20, pl: 6, pvp: 1.1, roe: 16, roic: 14, netMargin: 18,
        evEbitda: 5, revenueGrowth: 8, debtToEquity: 0.5, netDebt: 200000000, payout: 55,
        dy: 9, marketCap: 12000000000, avgLiquidity: 5000000, vacancy: 0, capRate: 0,
        qtdImoveis: 0, volatility: 22, beta: 0.8, sma200: 19, ema50: 19.5,
        sector: 'Energia Elétrica', fiiSubType: null,
        _missing: { pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false, evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false },
        _staleDays: 20,
    },
    ...overrides,
});

describe('Fase 2 — A1: peso do upside no DEFENSIVO reduzido', () => {
    it('upside ≥30% concede no máximo +8 ao DEFENSIVO (antes +15)', () => {
        const res = scoringEngine.processAsset(makeCheapDefensive(), CTX);
        const pts = factorPoints(res, 'Perfil Defensivo', 'Upside Forte (>30%)');
        // Se a tese ficou barata o suficiente para o tier máximo, o bônus é +8.
        if (pts !== undefined) expect(pts).toBe(8);
        // Nenhum bônus de upside no Defensivo pode exceder +8.
        const upsideBonuses = auditFor(res, 'Perfil Defensivo')
            .filter(a => a.factor.startsWith('Upside') && a.type === 'bonus')
            .map(a => a.points);
        upsideBonuses.forEach(p => expect(p).toBeLessThanOrEqual(8));
    });

    it('o tier marginal "Upside Leve (>10%)" deixou de existir no DEFENSIVO', () => {
        const res = scoringEngine.processAsset(makeCheapDefensive(), CTX);
        const leve = auditFor(res, 'Perfil Defensivo').some(a => a.factor.includes('Upside Leve'));
        expect(leve).toBe(false);
    });
});

// ── K ──────────────────────────────────────────────────────────────────────
// Growth caro sem dividendo e P/L≥80: Graham não calcula (pl<80 falso), Bazin não
// calcula (dy=0) → sem âncora de valor → penalidade de múltiplo caro deve aparecer.
const makeExpensiveGrowth = (pl) => ({
    ticker: 'EXPN3', type: 'STOCK', name: 'Growth Caro', sector: 'Tecnologia',
    fiiSubType: null, price: 100, dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'EXPN3', price: 100, pl, pvp: 12, roe: 14, roic: 10, netMargin: 8,
        evEbitda: 40, revenueGrowth: 25, debtToEquity: 0.4, netDebt: 0, payout: 0,
        dy: 0, marketCap: 8000000000, avgLiquidity: 6000000, vacancy: 0, capRate: 0,
        qtdImoveis: 0, volatility: 40, beta: 1.3, sma200: 95, ema50: 98,
        sector: 'Tecnologia', fiiSubType: null,
        _missing: { pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false, evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false },
        _staleDays: 20,
    },
});

describe('Fase 2 — K: sobrepreço de growth caro sem âncora de valor', () => {
    it('P/L≥80 sem Graham/Bazin recebe penalidade de múltiplo caro em todos os perfis', () => {
        const res = scoringEngine.processAsset(makeExpensiveGrowth(90), CTX);
        expect(factorPoints(res, 'Perfil Defensivo', 'Múltiplo Caro sem Âncora')).toBe(-20);
        expect(factorPoints(res, 'Perfil Moderado', 'Múltiplo Caro sem Âncora')).toBe(-15);
        expect(factorPoints(res, 'Perfil Arrojado', 'Múltiplo Caro sem Âncora')).toBe(-8);
    });

    it('P/L moderado (<50) NÃO dispara a penalidade de múltiplo caro', () => {
        // pl=30 ainda calcula Graham (pl<80 e pvp>0) → tem âncora → K não age.
        const res = scoringEngine.processAsset(makeExpensiveGrowth(30), CTX);
        const has = res.auditLog.some(a => a.factor.includes('Múltiplo Caro sem Âncora'));
        expect(has).toBe(false);
    });
});

// ── E ──────────────────────────────────────────────────────────────────────
const makeCrypto = (ticker, mOverrides = {}) => ({
    ticker, type: 'CRYPTO', name: ticker, sector: 'Crypto', fiiSubType: null,
    price: 100, dbFlags: { isBlacklisted: false },
    metrics: {
        ticker, price: 100, marketCap: 5000000000, avgLiquidity: 500000000,
        volatility: 60, beta: 1.2, sma200: 90, dy: 0, pvp: 0, pl: 0,
        _missing: {}, _staleDays: 0, ...mOverrides,
    },
});

describe('Fase 2 — E: variância de qualidade e trava no BOLD de cripto', () => {
    it('volatilidade entra no score que ordena: duas mid caps iguais divergem por vol', () => {
        const calmo = scoringEngine.processAsset(makeCrypto('CALM', { marketCap: 8000000000, volatility: 30 }), CTX);
        const volatil = scoringEngine.processAsset(makeCrypto('WILD', { marketCap: 8000000000, volatility: 110 }), CTX);
        // Ambos eram 90 antes; agora a vol diferencia o BOLD (primário da faixa mid).
        expect(calmo.scores.BOLD).toBeGreaterThan(volatil.scores.BOLD);
    });

    it('small cap de baixa liquidez OU vol extrema tem BOLD limitado a 80 (teto especulativo)', () => {
        const arriscada = scoringEngine.processAsset(
            makeCrypto('TINY', { marketCap: 300000000, avgLiquidity: 10000000, volatility: 120 }), CTX);
        expect(arriscada.scores.BOLD).toBeLessThanOrEqual(80);
        expect(arriscada.auditLog.some(a => a.factor.includes('Teto Especulativo Cripto'))).toBe(true);
    });

    it('volatilidade extrema (>100%) gera penalidade no perfil primário', () => {
        const res = scoringEngine.processAsset(makeCrypto('WILD', { marketCap: 8000000000, volatility: 130 }), CTX);
        expect(res.auditLog.some(a => a.factor.includes('Volatilidade Extrema (>100%)'))).toBe(true);
    });
});
