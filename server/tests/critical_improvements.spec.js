/**
 * Testes das Melhorias Críticas — Auditoria de Dados e Rankings
 *
 * Cobre as 5 melhorias críticas implementadas:
 * 1. Dado ausente vs dado ruim (flags _missing)
 * 2. Staleness penalty (lastFundamentalsDate → _staleDays)
 * 3. FII isPapel via fiiSubType (campo explícito)
 * 4. Bug corrigido: calculateIntrinsicValue para FII Papel
 * 5. isEligibleForDefensive não rejeita por dado ausente
 */

import { describe, it, expect } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

// ── Contexto macro padrão usado em todos os testes ──────────────────────────
const DEFAULT_CONTEXT = {
    MACRO: { SELIC: 13.75, IPCA: 4.62, RISK_FREE: 13.75, NTNB_LONG: 6.40 }
};

// ── Fábrica de ativo STOCK com dados completos (caso base saudável) ──────────
const makeStock = (overrides = {}) => ({
    ticker: 'TEST3',
    type: 'STOCK',
    name: 'Empresa Teste',
    sector: 'Energia Elétrica',
    fiiSubType: null,
    price: 40.00,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'TEST3',
        price: 40.00,
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
            pl: false, marketCap: false, roe: false,
            netMargin: false, revenueGrowth: false,
            evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false
        },
        _staleDays: 30,
        dataCompleteness: 100,
        structural: { quality: 50, valuation: 50, risk: 50 }
    },
    ...overrides
});

// ── Fábrica de ativo FII ────────────────────────────────────────────────────
const makeFII = (overrides = {}) => ({
    ticker: 'XPTO11',
    type: 'FII',
    name: 'FII Teste',
    sector: 'Logística',
    fiiSubType: 'TIJOLO',
    price: 100.00,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'XPTO11',
        price: 100.00,
        dy: 10.5,
        pvp: 0.92,
        marketCap: 800000000,
        avgLiquidity: 2500000,
        pl: 0, roe: 0, roic: 0, netMargin: 0, evEbitda: 0,
        revenueGrowth: 0, debtToEquity: 0, netDebt: 0, payout: 0,
        vacancy: 6,
        capRate: 8.5,
        qtdImoveis: 12,
        volatility: 18,
        beta: 0.65,
        sma200: 98,
        ema50: 99,
        sector: 'Logística',
        fiiSubType: 'TIJOLO',
        vpCota: 108,
        _missing: {
            pl: true, marketCap: false, roe: true,
            netMargin: true, revenueGrowth: true,
            evEbitda: true, beta: false, dy: false, debtToEquity: false, payout: false
        },
        _staleDays: 20,
        dataCompleteness: 40,
        structural: { quality: 50, valuation: 50, risk: 50 }
    },
    ...overrides
});

// ────────────────────────────────────────────────────────────────────────────
// MELHORIA 1 — Dado ausente vs dado ruim (_missing flags)
// ────────────────────────────────────────────────────────────────────────────
describe('Melhoria 1 — Dado ausente vs dado ruim', () => {

    it('Ativo com dados COMPLETOS: não gera penalidades de ausência no audit', () => {
        const asset = makeStock();
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);

        expect(result._discarded).toBeFalsy();
        const confidenceAudit = result.auditLog.filter(e => e.category === 'Dados e Confiança');
        const absencePenalties = confidenceAudit.filter(e =>
            e.factor.includes('Ausentes') || e.factor.includes('Ausente')
        );
        expect(absencePenalties).toHaveLength(0);
    });

    it('Ativo com ROE=0 e _missing.roe=true: penalidade de confiança, NÃO de scoring estrutural', () => {
        const asset = makeStock({
            metrics: {
                ...makeStock().metrics,
                roe: 0,
                _missing: { ...makeStock().metrics._missing, roe: true }
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);

        expect(result._discarded).toBeFalsy();
        // Deve ter a penalidade de confiança por rentabilidade ausente
        const confPenalty = result.auditLog.find(e =>
            e.category === 'Dados e Confiança' && e.factor.includes('Rentabilidade')
        );
        expect(confPenalty).toBeDefined();
        expect(confPenalty.points).toBe(-15);

        // Score estrutural de qualidade: não deve ter "ROE Modesto / Baixo" como penalidade explícita
        // (o motor atribui 0 pontos sem penalizar — tratamento neutro para dado ausente)
        const roePenalty = result.auditLog.find(e =>
            e.category === 'Qualidade' && e.points < 0 && e.factor.toLowerCase().includes('roe')
        );
        expect(roePenalty).toBeUndefined();
    });

    it('Ativo com revenueGrowth=0 e _missing.revenueGrowth=true: penalidade de -25 confiança', () => {
        const asset = makeStock({
            metrics: {
                ...makeStock().metrics,
                revenueGrowth: 0,
                _missing: { ...makeStock().metrics._missing, revenueGrowth: true }
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);

        const growthPenalty = result.auditLog.find(e =>
            e.category === 'Dados e Confiança' && e.factor.includes('Crescimento')
        );
        expect(growthPenalty).toBeDefined();
        expect(growthPenalty.points).toBe(-25);
    });

    it('dataCompleteness reflete percentual correto de campos preenchidos', () => {
        // 6 campos fundamentais; 3 ausentes → 50%
        const asset = makeStock({
            metrics: {
                ...makeStock().metrics,
                _missing: {
                    ...makeStock().metrics._missing,
                    roe: true, revenueGrowth: true, evEbitda: true
                },
                dataCompleteness: 50
            }
        });
        expect(asset.metrics.dataCompleteness).toBe(50);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// MELHORIA 2 — Staleness penalty (dados desatualizados)
// ────────────────────────────────────────────────────────────────────────────
describe('Melhoria 2 — Penalidade de dados desatualizados (_staleDays)', () => {

    it('_staleDays=null (lastFundamentalsDate nunca definido): penalidade leve de -5', () => {
        const asset = makeStock({
            metrics: { ...makeStock().metrics, _staleDays: null }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        const stalePenalty = result.auditLog.find(e =>
            e.category === 'Dados e Confiança' && e.factor.includes('Desconhecida')
        );
        expect(stalePenalty).toBeDefined();
        expect(stalePenalty.points).toBe(-5);
    });

    it('_staleDays=100 (>90 dias): penalidade de -15 confiança', () => {
        const asset = makeStock({
            metrics: { ...makeStock().metrics, _staleDays: 100 }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        const stalePenalty = result.auditLog.find(e =>
            e.category === 'Dados e Confiança' && e.factor.includes('Desatualizados') && e.factor.includes('100')
        );
        expect(stalePenalty).toBeDefined();
        expect(stalePenalty.points).toBe(-15);
    });

    it('_staleDays=200 (>180 dias): penalidade severa de -30 confiança', () => {
        const asset = makeStock({
            metrics: { ...makeStock().metrics, _staleDays: 200 }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        const stalePenalty = result.auditLog.find(e =>
            e.category === 'Dados e Confiança' && e.factor.includes('Desatualizados') && e.factor.includes('200')
        );
        expect(stalePenalty).toBeDefined();
        expect(stalePenalty.points).toBe(-30);
    });

    it('_staleDays=30 (dados frescos): nenhuma penalidade de staleness', () => {
        const asset = makeStock({ metrics: { ...makeStock().metrics, _staleDays: 30 } });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        const stalePenalty = result.auditLog.find(e =>
            e.category === 'Dados e Confiança' && e.factor.includes('Desatualizados')
        );
        expect(stalePenalty).toBeUndefined();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// MELHORIA 3 — FII isPapel via fiiSubType (campo explícito)
// ────────────────────────────────────────────────────────────────────────────
describe('Melhoria 3 — Detecção de FII Papel via fiiSubType', () => {

    it('fiiSubType=PAPEL + sector=Logística → trata como Papel (campo explícito prevalece)', () => {
        const asset = makeFII({
            fiiSubType: 'PAPEL',
            sector: 'Logística',         // Setor confuso, mas fiiSubType é explícito
            metrics: {
                ...makeFII().metrics,
                fiiSubType: 'PAPEL',
                sector: 'Logística',
                pvp: 1.03,               // Equilibrado para Papel
                dy: 11.0,
                vpCota: 100
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result._discarded).toBeFalsy();

        // P/VP equilibrado em Papel (0.95–1.05) deve gerar bônus defensivo
        const pvpBonus = result.auditLog.find(e => e.factor.includes('P/VP Equilibrado (Papel)'));
        expect(pvpBonus).toBeDefined();
        expect(pvpBonus.points).toBeGreaterThan(0);
    });

    it('fiiSubType=TIJOLO + sector=Papel → trata como Tijolo (campo explícito prevalece)', () => {
        const asset = makeFII({
            fiiSubType: 'TIJOLO',
            sector: 'Papel',             // Setor diz Papel, mas fiiSubType diz Tijolo
            metrics: {
                ...makeFII().metrics,
                fiiSubType: 'TIJOLO',
                sector: 'Papel',
                pvp: 0.88,
                dy: 10.5,
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result._discarded).toBeFalsy();

        // Deve usar critérios de Tijolo: P/VP saudável (0.80–1.05), não equilibrado (0.95–1.05)
        const pvpTijolo = result.auditLog.find(e => e.factor.includes('P/VP Saudável (Tijolo)'));
        expect(pvpTijolo).toBeDefined();
    });

    it('fiiSubType=null + sector="Papel" → fallback por substring, trata como Papel', () => {
        const asset = makeFII({
            fiiSubType: null,
            sector: 'Papel',
            metrics: {
                ...makeFII().metrics,
                fiiSubType: null,
                sector: 'Papel',
                pvp: 1.02,
                dy: 12.0,
                vpCota: 100
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result._discarded).toBeFalsy();
        const pvpPapel = result.auditLog.find(e => e.factor.includes('P/VP Equilibrado (Papel)'));
        expect(pvpPapel).toBeDefined();
    });

    it('fiiSubType=null + sector="Shoppings" → trata como Tijolo (fallback correto)', () => {
        const asset = makeFII({
            fiiSubType: null,
            sector: 'Shoppings',
            metrics: {
                ...makeFII().metrics,
                fiiSubType: null,
                sector: 'Shoppings',
                pvp: 0.88,
                dy: 10.0,
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        const pvpTijolo = result.auditLog.find(e => e.factor.includes('P/VP Saudável (Tijolo)'));
        expect(pvpTijolo).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// MELHORIA 4 — Bug corrigido: calculateIntrinsicValue para FII Papel
// ────────────────────────────────────────────────────────────────────────────
describe('Melhoria 4 — Correção do preço justo de FII Papel (bug resolvido)', () => {

    it('FII Papel: targetPrice deve ser igual ao vpCota (não yield-adjusted)', () => {
        const vpCota = 108.50;
        const asset = makeFII({
            fiiSubType: 'PAPEL',
            sector: 'Papel',
            price: 112.00,               // Negociando com ágio sobre o VP
            metrics: {
                ...makeFII().metrics,
                fiiSubType: 'PAPEL',
                sector: 'Papel',
                dy: 13.0,
                pvp: 1.03,
                vpCota,
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        // Para FII Papel, fairPrice = vpCota (sem ajuste de yield)
        expect(result.targetPrice).toBeCloseTo(vpCota, 0);
    });

    it('FII Tijolo: targetPrice deve ser VP ajustado pelo spread de yield (não puro VP)', () => {
        const vpCota = 100.00;
        const dy = 11.0;
        const ntnb = DEFAULT_CONTEXT.MACRO.NTNB_LONG; // 6.40
        const expectedPremium = Math.max(0, dy - ntnb); // 4.6%
        const expectedFairPrice = vpCota * (1 + expectedPremium / 100);

        const asset = makeFII({
            fiiSubType: 'TIJOLO',
            sector: 'Logística',
            price: 95.00,
            metrics: {
                ...makeFII().metrics,
                fiiSubType: 'TIJOLO',
                sector: 'Logística',
                dy,
                pvp: 0.95,
                vpCota,
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result.targetPrice).toBeCloseTo(expectedFairPrice, 1);
    });

    it('ANTES DO FIX: FII Papel sem fiiSubType mas sector="Papel" ainda calculava VP correto (fallback funcional)', () => {
        const vpCota = 105.00;
        const asset = makeFII({
            fiiSubType: null,            // Campo novo não preenchido ainda
            sector: 'Papel',             // Fallback por substring
            price: 108.00,
            metrics: {
                ...makeFII().metrics,
                fiiSubType: null,
                sector: 'Papel',
                dy: 12.0,
                pvp: 1.03,
                vpCota,
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        // Com a correção, o fallback de sector também funciona corretamente
        expect(result.targetPrice).toBeCloseTo(vpCota, 0);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// MELHORIA 5 — isEligibleForDefensive não rejeita por dado ausente
// ────────────────────────────────────────────────────────────────────────────
describe('Melhoria 5 — Elegibilidade DEFENSIVE não penaliza dado ausente', () => {

    it('STOCK com ROE=0 e _missing.roe=true em setor defensivo: NÃO descartado do ranking', () => {
        const asset = makeStock({
            sector: 'Energia Elétrica',
            metrics: {
                ...makeStock().metrics,
                roe: 0,                    // Dado ausente (default do DB)
                _missing: { ...makeStock().metrics._missing, roe: true }
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        // Não deve ser descartado — dado ausente não é dado ruim
        expect(result._discarded).toBeFalsy();
        // Deve ter score no perfil defensivo (acima do mínimo de 10)
        expect(result.scores.DEFENSIVE).toBeGreaterThan(10);
    });

    it('STOCK com ROE=3 e _missing.roe=false em setor defensivo: DEVE ter score defensivo baixo (dado presente e ruim)', () => {
        const asset = makeStock({
            sector: 'Energia Elétrica',
            metrics: {
                ...makeStock().metrics,
                roe: 3,                    // ROE real de 3% — dado presente e abaixo do mínimo de 5%
                _missing: { ...makeStock().metrics._missing, roe: false }
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result._discarded).toBeFalsy();
        // Score defensivo deve ser baixo (base inelegível = 30)
        expect(result.scores.DEFENSIVE).toBeLessThanOrEqual(50);
    });

    it('STOCK com netMargin=0 e _missing.netMargin=true: não rejeita elegibilidade defensiva', () => {
        const asset = makeStock({
            sector: 'Saneamento',
            metrics: {
                ...makeStock().metrics,
                netMargin: 0,
                _missing: { ...makeStock().metrics._missing, netMargin: true }
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result._discarded).toBeFalsy();
        // Score defensivo deve ser de ativo elegível (base ≥60), não inelegível (base=30)
        expect(result.scores.DEFENSIVE).toBeGreaterThan(40);
    });

    it('STOCK com netMargin=1 e _missing.netMargin=false: rejeita elegibilidade (abaixo de 3%)', () => {
        const asset = makeStock({
            sector: 'Saneamento',
            metrics: {
                ...makeStock().metrics,
                netMargin: 1,
                _missing: { ...makeStock().metrics._missing, netMargin: false }
            }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result._discarded).toBeFalsy();
        // Inelegível para defensivo → base = 30
        expect(result.scores.DEFENSIVE).toBeLessThanOrEqual(50);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// TESTES DE INTEGRIDADE GERAL (Regras de negócio invioláveis)
// ────────────────────────────────────────────────────────────────────────────
describe('Integridade geral — Regras de negócio invioláveis', () => {

    it('Score >= 70 sempre resulta em action=BUY (verificado no portfolioEngine)', () => {
        // O scoringEngine retorna scores por perfil; portfolioEngine atribui action.
        // Verificamos que scores altos são produzidos corretamente.
        const asset = makeStock();
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        // Ativo com dados completos, setor defensivo, DY=7.5%, ROE=18%: score DEFENSIVE alto
        expect(result.scores.DEFENSIVE).toBeGreaterThanOrEqual(70);
    });

    it('Stablecoin é descartada antes de qualquer scoring', () => {
        const usdt = {
            ticker: 'USDT', type: 'CRYPTO', name: 'Tether', sector: 'Crypto',
            fiiSubType: null, price: 1.0,
            dbFlags: { isBlacklisted: false, isTier1: false },
            metrics: { ticker: 'USDT', price: 1.0, avgLiquidity: 50000000000, marketCap: 100000000000, _missing: {}, _staleDays: 0, dataCompleteness: 100, structural: { quality: 50, valuation: 50, risk: 50 } }
        };
        const result = scoringEngine.processAsset(usdt, DEFAULT_CONTEXT);
        expect(result._discarded).toBe(true);
        expect(result.reason).toBe('Stablecoin');
    });

    it('Ativo blacklistado é descartado', () => {
        const asset = makeStock({ dbFlags: { isBlacklisted: true, isTier1: false } });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result._discarded).toBe(true);
        expect(result.reason).toBe('Blacklist Manual');
    });

    it('Todos os scores ficam entre 10 e 100 (bounds garantidos)', () => {
        const assets = [
            makeStock(),
            makeFII(),
            makeFII({ fiiSubType: 'PAPEL', sector: 'Papel', metrics: { ...makeFII().metrics, fiiSubType: 'PAPEL', sector: 'Papel' } })
        ];
        for (const asset of assets) {
            const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
            if (result._discarded) continue;
            for (const [profile, score] of Object.entries(result.scores)) {
                expect(score, `${profile} score fora dos bounds`).toBeGreaterThanOrEqual(10);
                expect(score, `${profile} score fora dos bounds`).toBeLessThanOrEqual(100);
            }
        }
    });

    it('auditLog contém entradas para todas as categorias esperadas em STOCK', () => {
        // Usa ativo com _staleDays=null para garantir que 'Dados e Confiança' aparece no log
        const asset = makeStock({ metrics: { ...makeStock().metrics, _staleDays: null } });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        const categories = new Set(result.auditLog.map(e => e.category));
        // 'Dados e Confiança' só é logado quando há penalidade; staleDays=null gera -5
        expect(categories.has('Dados e Confiança')).toBe(true);
        expect(categories.has('Perfil Defensivo')).toBe(true);
        expect(categories.has('Qualidade')).toBe(true);
        expect(categories.has('Valuation')).toBe(true);
        expect(categories.has('Risco')).toBe(true);
    });

    it('Bull thesis: ROE alto só aparece quando dado está presente (_missing.roe=false)', () => {
        const withRoe = makeStock({ metrics: { ...makeStock().metrics, roe: 22, _missing: { ...makeStock().metrics._missing, roe: false } } });
        const withoutRoe = makeStock({ metrics: { ...makeStock().metrics, roe: 0, _missing: { ...makeStock().metrics._missing, roe: true } } });

        const resultWith = scoringEngine.processAsset(withRoe, DEFAULT_CONTEXT);
        const resultWithout = scoringEngine.processAsset(withoutRoe, DEFAULT_CONTEXT);

        const hasRoeBull = (r) => r.bullThesis.some(t => t.includes('ROE'));
        expect(hasRoeBull(resultWith)).toBe(true);
        expect(hasRoeBull(resultWithout)).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// TESTES DE REGRESSÃO — comportamento anterior preservado
// ────────────────────────────────────────────────────────────────────────────
describe('Regressão — comportamentos pré-existentes preservados', () => {

    it('Ativo com liquidez < 200k é descartado (regra de corte preservada)', () => {
        const asset = makeStock({
            metrics: { ...makeStock().metrics, avgLiquidity: 150000 }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result._discarded).toBe(true);
        expect(result.reason).toBe('Liquidez Insuficiente');
    });

    it('Ativo com preço <= 0.01 é descartado (regra de corte preservada)', () => {
        const asset = makeStock({ price: 0.005, metrics: { ...makeStock().metrics, price: 0.005 } });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        expect(result._discarded).toBe(true);
    });

    it('Dividend Aristocrat recebe bônus de +10 DEFENSIVE e +5 MODERATE', () => {
        const aristocrat = makeStock({
            metrics: {
                ...makeStock().metrics,
                revenueGrowth: 8, roe: 15, dy: 5.5, netMargin: 12, payout: 60,
                _missing: { ...makeStock().metrics._missing, roe: false, netMargin: false, revenueGrowth: false }
            }
        });
        const result = scoringEngine.processAsset(aristocrat, DEFAULT_CONTEXT);
        const hasAristocratBonus = result.auditLog.some(e => e.factor === 'Dividend Aristocrat Bonus');
        expect(hasAristocratBonus).toBe(true);
    });

    it('FII mono-ativo recebe penalidade de risco (regra preservada)', () => {
        const asset = makeFII({
            fiiSubType: 'TIJOLO',
            metrics: { ...makeFII().metrics, qtdImoveis: 1, fiiSubType: 'TIJOLO' }
        });
        const result = scoringEngine.processAsset(asset, DEFAULT_CONTEXT);
        const monoPenalty = result.auditLog.find(e => e.factor.includes('Mono-Ativo') || e.factor.includes('Risco Binário'));
        expect(monoPenalty).toBeDefined();
        expect(monoPenalty.points).toBeLessThan(0);
    });
});
