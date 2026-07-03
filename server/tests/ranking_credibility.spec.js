/**
 * Guardas de credibilidade do ranking (jul/2026) — evidências do ranking real de
 * 2026-07-02 que motivaram cada guarda:
 *  - CACR11 (FII, DY 47,8%) marcava 85 BUY via bônus "Yield Extremo" → anti yield-trap;
 *  - Bazin com yield-alvo fixo 6% inflava preço justo com Selic ~14% → âncora NTN-B+2pp (só BR);
 *  - beta ausente (=0) ganhava bônus "Beta Defensivo" → exige beta > 0;
 *  - vpCota nunca chegava ao scoring → fallback price/pvp no VP de FII;
 *  - crescimento de financeiras >30% era ZERADO (degrau) → capado em 30;
 *  - cripto: 16/16 BUY com bases 90/95 + isenção de teto → recalibração;
 *  - Brasil 10 listava inelegíveis como DEFENSIVE → prioriza o gate;
 *  - setas de posição comparavam contra rascunho não publicado → baseline publicado.
 */
import { describe, it, expect, vi } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';

// Mock só do model: calculateRankingDelta consulta MarketAnalysis; sem DB no teste.
vi.mock('../models/MarketAnalysis.js', () => ({
    default: { findOne: vi.fn(() => ({ sort: () => Promise.resolve(null) })) },
}));

const CTX = { MACRO: { SELIC: 14.25, IPCA: 4.5, RISK_FREE: 14.25, NTNB_LONG: 6.3 } };

const NO_MISSING = { pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false, evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false };

const makeFii = ({ metrics: mOver = {}, ...rest } = {}) => ({
    ticker: 'FTST11', type: 'FII', name: 'FII Teste', sector: 'Recebíveis', fiiSubType: 'PAPEL',
    price: 100, dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'FTST11', price: 100, pl: 0, pvp: 0.98, roe: 0, netMargin: 0, evEbitda: 0,
        revenueGrowth: 0, debtToEquity: 0, netDebt: 0, payout: 0,
        dy: 14, marketCap: 800000000, avgLiquidity: 3000000, vacancy: 0, capRate: 0, qtdImoveis: 0,
        volatility: 12, beta: 0.5, sma200: 98, ema50: 99, sector: 'Recebíveis', fiiSubType: 'PAPEL',
        _missing: NO_MISSING, _staleDays: 10, dataCompleteness: 100,
        ...mOver,
    },
    ...rest,
});

const makeStock = (type, { metrics: mOver = {}, ...rest } = {}) => ({
    ticker: type === 'STOCK_US' ? 'USQ' : 'BRQ3', type, name: 'Ação Teste',
    sector: type === 'STOCK_US' ? 'Consumer Defensive' : 'Energia',
    usSubType: type === 'STOCK_US' ? 'STOCK' : null, fiiSubType: null, price: 100,
    dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'Q', price: 100, pl: 8, pvp: 1.2, roe: 18, roic: 12, netMargin: 12, evEbitda: 6,
        revenueGrowth: 8, debtToEquity: 0.5, netDebt: 0, payout: 50,
        dy: 6, marketCap: 50e9, avgLiquidity: 300000000,
        vacancy: 0, capRate: 0, qtdImoveis: 0, volatility: 18, beta: 0.9, sma200: 95, ema50: 97,
        sector: type === 'STOCK_US' ? 'Consumer Defensive' : 'Energia', fiiSubType: null,
        _missing: NO_MISSING, _staleDays: 10, dataCompleteness: 100,
        ...mOver,
    },
    ...rest,
});

const makeCrypto = (ticker, mOver = {}) => ({
    ticker, type: 'CRYPTO', name: ticker, sector: 'Crypto', fiiSubType: null,
    price: 100, dbFlags: { isBlacklisted: false },
    metrics: {
        ticker, price: 100, marketCap: 900e9, avgLiquidity: 20e9,
        volatility: 35, beta: 0, sma200: 90, dy: 0, pvp: 0, pl: 0,
        _missing: { revenueGrowth: true, roe: true, netMargin: true, pl: true, evEbitda: true, beta: true },
        _staleDays: null, ...mOver,
    },
});

const hasFactor = (res, substr) => res.auditLog.some(a => (a.factor || '').includes(substr));

// ── Anti yield-trap FII ──────────────────────────────────────────────────────
describe('Anti yield-trap FII (DY > 20% = provável amortização)', () => {
    it('DY 47,8% (caso CACR11): sem bônus de yield, penalidade nos dois perfis', () => {
        const res = scoringEngine.processAsset(makeFii({ metrics: { dy: 47.82 } }), CTX);
        expect(hasFactor(res, 'Yield Insustentável')).toBe(true);
        expect(hasFactor(res, 'Yield Excepcional')).toBe(false);
        expect(hasFactor(res, 'Yield Extremo')).toBe(false);
        // Sem o maior bônus de valuation estrutural
        expect(hasFactor(res, 'Spread Não Confiável')).toBe(true);
        expect(hasFactor(res, 'Spread Excelente')).toBe(false);
    });

    it('FII de papel legítimo (DY 14-16% em CDI alto) NÃO é punido', () => {
        const res = scoringEngine.processAsset(makeFii({ metrics: { dy: 15.6 } }), CTX);
        expect(hasFactor(res, 'Yield Insustentável')).toBe(false);
        // spread 15.6 − 6.3 = 9.3 ≥ 7 → yield extremo do BOLD segue valendo
        expect(hasFactor(res, 'Yield Extremo')).toBe(true);
    });

    it('yield-trap pontua abaixo do FII legítimo em MODERATE e BOLD', () => {
        const trap = scoringEngine.processAsset(makeFii({ metrics: { dy: 47.82 } }), CTX);
        const legit = scoringEngine.processAsset(makeFii({ metrics: { dy: 15.6 } }), CTX);
        expect(trap.scores.MODERATE).toBeLessThan(legit.scores.MODERATE);
        expect(trap.scores.BOLD).toBeLessThan(legit.scores.BOLD);
    });
});

// ── Bazin ancorado no macro (só BR) ─────────────────────────────────────────
describe('Bazin ancorado no macro', () => {
    it('STOCK BR: yield-alvo = NTN-B (6,3) + 2 = 8,3% → bazinPrice = dy/8,3%', () => {
        // dy 6% de 100 → R$6/ação; 6 / 0.083 = 72.29
        const res = scoringEngine.processAsset(makeStock('STOCK', { metrics: { pvp: 0, pl: 0, dy: 6, _missing: { ...NO_MISSING, pl: true } } }), CTX);
        expect(res.metrics.bazinPrice).toBeCloseTo(6 / 0.083, 1);
    });

    it('STOCK_US mantém o yield-alvo clássico de 6% (NTN-B não ancora dólar)', () => {
        const res = scoringEngine.processAsset(makeStock('STOCK_US', { metrics: { pvp: 0, pl: 0, dy: 6, _missing: { ...NO_MISSING, pl: true } } }), CTX);
        expect(res.metrics.bazinPrice).toBeCloseTo(6 / 0.06, 1);
    });

    it('piso de 6%: com NTN-B artificialmente baixa, o yield-alvo não cai abaixo do clássico', () => {
        const lowCtx = { MACRO: { ...CTX.MACRO, NTNB_LONG: 2.0 } };
        const res = scoringEngine.processAsset(makeStock('STOCK', { metrics: { pvp: 0, pl: 0, dy: 6, _missing: { ...NO_MISSING, pl: true } } }), lowCtx);
        // max(6, 2+2) = 6% → 6/0.06 = 100
        expect(res.metrics.bazinPrice).toBeCloseTo(100, 1);
    });
});

// ── Beta ausente sem bônus ───────────────────────────────────────────────────
describe('Beta ausente (=0) não ganha bônus defensivo', () => {
    it('STOCK com beta 0 não recebe "Beta Defensivo (<0.7)"', () => {
        const res = scoringEngine.processAsset(makeStock('STOCK', { metrics: { beta: 0, _missing: { ...NO_MISSING, beta: true } } }), CTX);
        expect(hasFactor(res, 'Beta Defensivo')).toBe(false);
    });

    it('STOCK com beta 0.5 real segue recebendo o bônus', () => {
        const res = scoringEngine.processAsset(makeStock('STOCK', { metrics: { beta: 0.5 } }), CTX);
        expect(hasFactor(res, 'Beta Defensivo')).toBe(true);
    });

    it('FII com beta 0 não recebe "Beta Ultra Defensivo" nem "Beta Defensivo"', () => {
        const res = scoringEngine.processAsset(makeFii({ metrics: { beta: 0 } }), CTX);
        expect(hasFactor(res, 'Beta Ultra Defensivo')).toBe(false);
        expect(hasFactor(res, 'Beta Defensivo')).toBe(false);
    });
});

// ── vpCota derivado de price/pvp ─────────────────────────────────────────────
describe('VP de FII sem vpCota persiste via price/pvp', () => {
    it('FII de papel com pvp 0.80 e sem vpCota: fairPrice = 100/0.80 = 125', () => {
        const res = scoringEngine.processAsset(makeFii({ metrics: { pvp: 0.80 } }), CTX);
        expect(res.targetPrice).toBeCloseTo(125, 0);
    });

    it('vpCota explícito em metrics tem precedência sobre o derivado', () => {
        const res = scoringEngine.processAsset(makeFii({ metrics: { pvp: 0.80, vpCota: 110 } }), CTX);
        expect(res.targetPrice).toBeCloseTo(110, 0);
    });
});

// ── Financeiras: crescimento capado, não zerado ──────────────────────────────
describe('Crescimento de financeiras >30% é capado em 30 (não zerado)', () => {
    it('banco crescendo 35% mantém bônus de crescimento (tier >20)', () => {
        const res = scoringEngine.processAsset(
            makeStock('STOCK', { metrics: { revenueGrowth: 35, sector: 'Bancos' }, sector: 'Bancos' }), CTX);
        expect(hasFactor(res, 'Crescimento Receita Alto (>20%)')).toBe(true);
        // Mas o tier excepcional (>30) não dispara — o cap segura em 30
        expect(hasFactor(res, 'Crescimento Receita Excepcional (>30%)')).toBe(false);
    });
});

// ── Cripto recalibrada ───────────────────────────────────────────────────────
describe('Cripto recalibrada: bases menores, confiança aplicável, sem isenção de teto', () => {
    it('blue chip líquida em tendência não crava mais 100 (diferenciação no topo)', () => {
        const btc = scoringEngine.processAsset(makeCrypto('BTC', { sma200: 90 }), CTX);
        expect(btc.scores.DEFENSIVE).toBeGreaterThanOrEqual(70); // segue BUY
        expect(btc.scores.DEFENSIVE).toBeLessThan(100);          // sem teto artificial
    });

    it('cripto NÃO é cobrada por métricas de empresa (revenueGrowth/ROE inaplicáveis)', () => {
        const btc = scoringEngine.processAsset(makeCrypto('BTC'), CTX);
        expect(hasFactor(btc, 'Dados de Crescimento Ausentes')).toBe(false);
        expect(hasFactor(btc, 'Dados de Rentabilidade Ausentes')).toBe(false);
    });

    it('top-10 líquida fica abaixo da blue chip (caso TRX=100=BTC não se repete)', () => {
        const btc = scoringEngine.processAsset(makeCrypto('BTC'), CTX);
        const trx = scoringEngine.processAsset(makeCrypto('TRX', { marketCap: 30e9, avgLiquidity: 2e9 }), CTX);
        const trxBest = Math.max(...Object.values(trx.scores));
        const btcBest = Math.max(...Object.values(btc.scores));
        expect(trxBest).toBeLessThan(btcBest);
    });

    it('mid cap e small cap ficam abaixo do BUY sem bônus reais', () => {
        const mid = scoringEngine.processAsset(makeCrypto('MID', { marketCap: 8e9, avgLiquidity: 500e6, volatility: 60 }), CTX);
        const small = scoringEngine.processAsset(makeCrypto('TINY', { marketCap: 500e6, avgLiquidity: 30e6, volatility: 90 }), CTX);
        expect(mid.scores.BOLD).toBeLessThan(70);
        expect(small.scores.BOLD).toBeLessThan(70);
        expect(small.scores.BOLD).toBeLessThan(mid.scores.BOLD);
    });
});

// ── Brasil 10: prioriza elegíveis do gate defensivo ──────────────────────────
describe('getTop5Defensive prioriza elegíveis do gate', () => {
    it('inelegível com score maior fica atrás dos elegíveis', async () => {
        const { getTop5Defensive } = await import('../services/aiResearchService.js');
        const mk = (ticker, def, eligible) => ({
            ticker, type: 'STOCK', sector: 'Energia',
            scores: { DEFENSIVE: def, MODERATE: def - 5, BOLD: def - 10 },
            metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
            isDefensiveEligible: eligible,
        });
        const assets = [
            mk('INEL3', 95, false), // maior score, mas reprovado no gate
            mk('ELI13', 80, true),
            mk('ELI23', 78, true),
            mk('ELI33', 76, true),
            mk('ELI43', 74, true),
            mk('ELI53', 72, true),
        ];
        const top = getTop5Defensive(assets);
        expect(top.map(a => a.ticker)).toEqual(['ELI13', 'ELI23', 'ELI33', 'ELI43', 'ELI53']);
    });

    it('inelegíveis completam a lista quando faltam elegíveis (backfill)', async () => {
        const { getTop5Defensive } = await import('../services/aiResearchService.js');
        const mk = (ticker, def, eligible) => ({
            ticker, type: 'STOCK', sector: 'Energia',
            scores: { DEFENSIVE: def, MODERATE: def - 5, BOLD: def - 10 },
            metrics: { structural: { quality: 60, valuation: 60, risk: 60 } },
            isDefensiveEligible: eligible,
        });
        const assets = [mk('ELI13', 80, true), mk('ELI23', 78, true), mk('INE13', 90, false), mk('INE23', 85, false)];
        const top = getTop5Defensive(assets);
        expect(top.map(a => a.ticker)).toEqual(['ELI13', 'ELI23', 'INE13', 'INE23']);
    });
});

// ── Delta com baseline publicado ─────────────────────────────────────────────
describe('calculateRankingDelta usa apenas relatório PUBLICADO como baseline', () => {
    it('consulta MarketAnalysis com isRankingPublished: true (mesmo critério do comparisonReport)', async () => {
        const { calculateRankingDelta } = await import('../services/aiResearchService.js');
        const MarketAnalysis = (await import('../models/MarketAnalysis.js')).default;
        await calculateRankingDelta([{ ticker: 'AAA3', position: 1 }], 'STOCK', 'BUY_HOLD');
        expect(MarketAnalysis.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ assetClass: 'STOCK', strategy: 'BUY_HOLD', isRankingPublished: true })
        );
    });
});
