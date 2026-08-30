/**
 * Invariantes do catálogo do Tesouro (`TreasuryBond`).
 *
 * Os casos são os defeitos REAIS encontrados em 30/08/2026, com os números do
 * banco de produção daquele dia. O ponto do arquivo é que cada um deles teria
 * acendido a aba Saúde no dia em que apareceu, em vez de ficar cinco meses no ar.
 */
import { describe, it, expect } from 'vitest';
import { auditTreasuryCatalog, CATALOG_RATE_RANGES } from '../utils/treasuryCatalogAudit.js';

const NOW = new Date('2026-08-30T15:00:00Z');
const bond = (over = {}) => ({
    title: 'Tesouro IPCA+ 2040',
    type: 'IPCA',
    index: 'IPCA',
    rate: 7.46,
    unitPrice: 1744.97,
    minInvestment: 30,
    maturityDate: '15/08/2040',
    updatedAt: new Date('2026-08-30T14:50:00Z'),
    ...over,
});

describe('auditTreasuryCatalog', () => {
    it('catálogo saudável não acusa nada', () => {
        const out = auditTreasuryCatalog([
            bond(),
            bond({ title: 'Tesouro Selic 2031', type: 'SELIC', index: 'SELIC', rate: 0.073, unitPrice: 19708.55, minInvestment: 197.09 }),
            bond({ title: 'Tesouro Prefixado 2029', type: 'PREFIXADO', index: 'PRE', rate: 14.13, unitPrice: 736.55 }),
            bond({ title: 'Tesouro Educa+ 2036', type: 'EDUCA', index: 'IPCA', rate: 7.55, unitPrice: 2023.98 }),
        ], { now: NOW });

        expect(out.total).toBe(4);
        expect(out.issues).toBe(0);
    });

    it('pega a duplicata criada pelo selo colado no nome', () => {
        // O par que a vitrine mostrava lado a lado, com taxas de dias diferentes.
        const out = auditTreasuryCatalog([
            bond({ title: 'Tesouro IPCA+ 2037 Juros Semestrais', rate: 7.67, unitPrice: 4279.09, minInvestment: 42.79 }),
            bond({ title: 'Tesouro IPCA+ 2037Juros Semestrais', rate: 7.53, unitPrice: 4236.8, minInvestment: 36 }),
        ], { now: NOW });

        expect(out.duplicates).toHaveLength(1);
        expect(out.duplicates[0].title).toBe('Tesouro IPCA+ 2037 Juros Semestrais');
        expect(out.duplicates[0].variants).toHaveLength(2);
        expect(out.glued).toEqual(['Tesouro IPCA+ 2037Juros Semestrais']);
        expect(out.issues).toBeGreaterThan(0);
    });

    it('a duplicata do Prefixado conta igual — o defeito não era só do IPCA+', () => {
        const out = auditTreasuryCatalog([
            bond({ title: 'Tesouro Prefixado 2037 Juros Semestrais', type: 'PREFIXADO', index: 'PRE', rate: 14.62, unitPrice: 786.68 }),
            bond({ title: 'Tesouro Prefixado 2037Juros Semestrais', type: 'PREFIXADO', index: 'PRE', rate: 14.22, unitPrice: 805.75, minInvestment: 8.05 }),
        ], { now: NOW });

        expect(out.duplicates).toHaveLength(1);
    });

    it('acusa a taxa que veio da coluna errada (Reserva 2036 como IPCA + 14%)', () => {
        const out = auditTreasuryCatalog([
            bond({ title: 'Tesouro Reserva 2036', type: 'IPCA', index: 'IPCA', rate: 14, unitPrice: 10.93, minInvestment: 30 }),
        ], { now: NOW });

        expect(out.implausibleRate).toHaveLength(1);
        expect(out.implausibleRate[0]).toMatchObject({ title: 'Tesouro Reserva 2036', rate: 14 });
        // E o mínimo maior que o título inteiro, no mesmo documento.
        expect(out.minAbovePu).toHaveLength(1);
        expect(out.minAbovePu[0]).toMatchObject({ min: 30, pu: 10.93 });
    });

    it('a mesma linha, já corrigida, passa limpa', () => {
        const out = auditTreasuryCatalog([
            bond({ title: 'Tesouro Reserva 2036', type: 'SELIC', index: 'SELIC', rate: 0, unitPrice: 10.93, minInvestment: 10.93 }),
        ], { now: NOW });

        expect(out.issues).toBe(0);
    });

    it('cada família tem a sua faixa — 14% é normal no prefixado e impossível no IPCA+', () => {
        const pre = auditTreasuryCatalog([
            bond({ title: 'Tesouro Prefixado 2032', type: 'PREFIXADO', index: 'PRE', rate: 14.6, unitPrice: 485.54 }),
        ], { now: NOW });
        expect(pre.implausibleRate).toHaveLength(0);

        const ipca = auditTreasuryCatalog([bond({ rate: 14.6 })], { now: NOW });
        expect(ipca.implausibleRate).toHaveLength(1);

        // Selic guarda ágio/deságio, não a taxa cheia: 14% ali é a Selic no lugar errado.
        const selic = auditTreasuryCatalog([
            bond({ title: 'Tesouro Selic 2031', type: 'SELIC', index: 'SELIC', rate: 14, unitPrice: 19708.55, minInvestment: 197.09 }),
        ], { now: NOW });
        expect(selic.implausibleRate).toHaveLength(1);
    });

    it('acusa índice incoerente com a família', () => {
        const out = auditTreasuryCatalog([
            bond({ title: 'Tesouro Selic 2031', type: 'SELIC', index: 'IPCA', rate: 0.07, unitPrice: 19708.55, minInvestment: 197.09 }),
        ], { now: NOW });
        expect(out.wrongIndex).toHaveLength(1);
    });

    it('título sem PU não vira "mínimo acima do PU", vira "sem PU"', () => {
        const out = auditTreasuryCatalog([bond({ unitPrice: 0, minInvestment: 30 })], { now: NOW });
        expect(out.missingPrice).toHaveLength(1);
        expect(out.minAbovePu).toHaveLength(0);
    });

    it('mede a idade do documento mais velho (o órfão de março)', () => {
        const out = auditTreasuryCatalog([
            bond(),
            bond({ title: 'Tesouro IPCA+ 2045Juros Semestrais', updatedAt: new Date('2026-03-25T16:05:00Z') }),
        ], { now: NOW });

        expect(out.oldestDays).toBeGreaterThan(150);
    });

    it('catálogo vazio não quebra', () => {
        expect(auditTreasuryCatalog([], { now: NOW })).toMatchObject({ total: 0, issues: 0, oldestDays: null });
        expect(auditTreasuryCatalog(undefined, { now: NOW }).total).toBe(0);
    });

    it('as faixas cobrem todas as famílias do enum', () => {
        expect(Object.keys(CATALOG_RATE_RANGES).sort())
            .toEqual(['EDUCA', 'IPCA', 'PREFIXADO', 'RENDAMAIS', 'SELIC']);
    });
});
