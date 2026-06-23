/**
 * Fase 3 — Dimensão de CONSISTÊNCIA / TRACK RECORD (achado B-A2).
 * Cobre o pré-requisito do roadmap (§2.10): série temporal de fundamentos + bônus de
 * durabilidade no Defensivo/Moderado, DORMENTE até a série acumular profundidade.
 *
 * Propriedades garantidas aqui:
 *   1) summarizeTrackRecord é puro e devolve null abaixo do mínimo de períodos (dormência).
 *   2) Sem trackRecord, o score é IDÊNTICO ao de antes (nada muda no ranking até haver dados).
 *   3) Com série suficiente, a continuidade concede um bônus pequeno e auditável.
 */
import { describe, it, expect } from 'vitest';
import { scoringEngine } from '../services/engines/scoringEngine.js';
import {
    summarizeTrackRecord,
    periodKey,
    TRACK_RECORD_MIN_PERIODS,
} from '../utils/trackRecord.js';

const CTX = { MACRO: { SELIC: 14.75, IPCA: 4.62, RISK_FREE: 14.75, NTNB_LONG: 6.3 } };

const auditFor = (res, profile) => res.auditLog.filter(a => a.category === profile);
const factorPoints = (res, profile, needle) => {
    const hit = auditFor(res, profile).find(a => a.factor.includes(needle));
    return hit ? hit.points : undefined;
};

// ── util pura ────────────────────────────────────────────────────────────────
describe('Fase 3 — summarizeTrackRecord (puro, dormente por padrão)', () => {
    const mkHistory = (n, over = {}) =>
        Array.from({ length: n }, (_, i) => ({
            period: `2026-${String(i + 1).padStart(2, '0')}`,
            roe: 18, dy: 8, payout: 60, revenueGrowth: 12, ...over,
        }));

    it('devolve null abaixo do mínimo de períodos (sem histórico retroativo → inativo)', () => {
        expect(summarizeTrackRecord([])).toBeNull();
        expect(summarizeTrackRecord(mkHistory(TRACK_RECORD_MIN_PERIODS - 1))).toBeNull();
        expect(summarizeTrackRecord(null)).toBeNull();
    });

    it('com períodos suficientes calcula as razões de consistência em [0,1]', () => {
        const tr = summarizeTrackRecord(mkHistory(TRACK_RECORD_MIN_PERIODS));
        expect(tr).not.toBeNull();
        expect(tr.periods).toBe(TRACK_RECORD_MIN_PERIODS);
        expect(tr.roeConsistency).toBe(1);
        expect(tr.dividendConsistency).toBe(1);
        expect(tr.payoutHealthy).toBe(1);
        expect(tr.revenuePositive).toBe(1);
    });

    it('mede continuidade: ROE oscilando abaixo do piso derruba a razão', () => {
        const half = [
            ...mkHistory(4, { roe: 18 }),
            ...mkHistory(4, { roe: 3 }).map((h, i) => ({ ...h, period: `2027-0${i + 1}` })),
        ];
        const tr = summarizeTrackRecord(half);
        expect(tr.roeConsistency).toBeCloseTo(0.5, 5);
    });

    it('deduplica períodos repetidos do mesmo mês', () => {
        const dup = mkHistory(TRACK_RECORD_MIN_PERIODS).map(h => ({ ...h, period: '2026-01' }));
        // todos no mesmo período → 1 período distinto → abaixo do mínimo → null
        expect(summarizeTrackRecord(dup)).toBeNull();
    });

    it('periodKey gera YYYY-MM em UTC', () => {
        expect(periodKey(new Date('2026-06-23T12:00:00Z'))).toBe('2026-06');
    });
});

// ── consumo no scoringEngine ─────────────────────────────────────────────────
const makeDefensiveStock = (trackRecord = undefined) => ({
    ticker: 'CONS3', type: 'STOCK', name: 'Compounder', sector: 'Energia Elétrica',
    fiiSubType: null, price: 40, dbFlags: { isBlacklisted: false, isTier1: false },
    metrics: {
        ticker: 'CONS3', price: 40, pl: 12, pvp: 1.8, roe: 18, roic: 15, netMargin: 22,
        evEbitda: 7, revenueGrowth: 12, debtToEquity: 0.8, netDebt: 500000000, payout: 55,
        dy: 7.5, marketCap: 15000000000, avgLiquidity: 3000000, vacancy: 0, capRate: 0,
        qtdImoveis: 0, volatility: 24, beta: 0.85, sma200: 39, ema50: 39.5,
        sector: 'Energia Elétrica', fiiSubType: null,
        _missing: { pl: false, marketCap: false, roe: false, netMargin: false, revenueGrowth: false, evEbitda: false, beta: false, dy: false, debtToEquity: false, payout: false },
        _staleDays: 20,
        trackRecord,
    },
});

describe('Fase 3 — track record no Defensivo de ações', () => {
    it('DORMENTE: sem trackRecord o score é idêntico (ranking inalterado até haver série)', () => {
        const semTr = scoringEngine.processAsset(makeDefensiveStock(undefined), CTX);
        const nuloTr = scoringEngine.processAsset(makeDefensiveStock(null), CTX);
        expect(semTr.scores.DEFENSIVE).toBe(nuloTr.scores.DEFENSIVE);
        // Nenhum fator de consistência aparece quando não há série.
        expect(auditFor(semTr, 'Perfil Defensivo').some(a => a.factor.includes('Consistente'))).toBe(false);
    });

    it('com série consistente concede bônus pequeno e auditável (+4 ROE, +3 dividendo)', () => {
        const base = scoringEngine.processAsset(makeDefensiveStock(null), CTX);
        const tr = { periods: 8, roeConsistency: 1, dividendConsistency: 1, payoutHealthy: 1, revenuePositive: 1 };
        const comTr = scoringEngine.processAsset(makeDefensiveStock(tr), CTX);
        expect(factorPoints(comTr, 'Perfil Defensivo', 'Rentabilidade Consistente')).toBe(4);
        expect(factorPoints(comTr, 'Perfil Defensivo', 'Pagador Consistente de Dividendos')).toBe(3);
        expect(comTr.scores.DEFENSIVE).toBe(base.scores.DEFENSIVE + 7);
    });

    it('Moderado ganha bônus por crescimento de receita sustentado', () => {
        const base = scoringEngine.processAsset(makeDefensiveStock(null), CTX);
        const tr = { periods: 8, roeConsistency: 0, dividendConsistency: 0, payoutHealthy: 0, revenuePositive: 1 };
        const comTr = scoringEngine.processAsset(makeDefensiveStock(tr), CTX);
        expect(factorPoints(comTr, 'Perfil Moderado', 'Crescimento de Receita Sustentado')).toBe(3);
        expect(comTr.scores.MODERATE).toBe(base.scores.MODERATE + 3);
    });
});

describe('Fase 3 — track record no Defensivo de FII', () => {
    const makeFii = (trackRecord = undefined) => ({
        ticker: 'CONS11', type: 'FII', name: 'FII Renda', sector: 'Recebíveis Imobiliários',
        fiiSubType: 'PAPEL', price: 100, dbFlags: { isBlacklisted: false, isTier1: false },
        metrics: {
            ticker: 'CONS11', price: 100, pl: 0, pvp: 0.98, roe: 0, netMargin: 0,
            evEbitda: 0, revenueGrowth: 0, debtToEquity: 0, payout: 0, dy: 12,
            marketCap: 1500000000, avgLiquidity: 4000000, vacancy: 0, capRate: 0,
            qtdImoveis: 0, volatility: 10, beta: 0.3, sector: 'Recebíveis Imobiliários', fiiSubType: 'PAPEL',
            _missing: { roe: true, netMargin: true, revenueGrowth: true, marketCap: false },
            _staleDays: 15, trackRecord,
        },
    });

    it('distribuição consistente concede +4 ao Defensivo do FII', () => {
        const base = scoringEngine.processAsset(makeFii(null), CTX);
        const tr = { periods: 10, roeConsistency: 0, dividendConsistency: 1, payoutHealthy: 0, revenuePositive: 0 };
        const comTr = scoringEngine.processAsset(makeFii(tr), CTX);
        expect(factorPoints(comTr, 'Perfil Defensivo', 'Distribuição Consistente')).toBe(4);
        expect(comTr.scores.DEFENSIVE).toBe(base.scores.DEFENSIVE + 4);
    });
});
