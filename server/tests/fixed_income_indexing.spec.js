/**
 * Cadastro de renda fixa na carteira: o índice e o spread que a posição herda do
 * catálogo do Tesouro (ago/2026).
 *
 * É o elo entre o catálogo e o dinheiro: o que se grava aqui é o que a curva de
 * accrual usa todo dia. O caso que motivou os testes é o "Tesouro Reserva 2036",
 * catalogado como IPCA + 14,00% (a coluna de rentabilidade ESTIMADA lida como
 * taxa contratada, e o índice adivinhado pelo nome) quando é Selic com spread
 * zero — quem cadastrasse pela busca levava o dobro do rendimento para a curva.
 */
import { describe, it, expect } from 'vitest';
import { resolveFixedIncomeIndexing } from '../utils/fixedIncomeIndexing.js';
import { effectiveAnnualRate, assetDailyFactor } from '../utils/fixedIncome.js';

// Macro de referência (valores reais de 30/08/2026).
const MACRO = { cdiRate: 13.9, selic: 14, ipca: 4.44 };

describe('resolveFixedIncomeIndexing — herança do catálogo', () => {
    it('cadastro pela busca: índice e spread vêm do catálogo', () => {
        const bond = { index: 'IPCA', rate: 7.67 }; // Tesouro IPCA+ 2037 Juros Semestrais
        expect(resolveFixedIncomeIndexing({ bond })).toEqual({ index: 'IPCA', spread: 7.67 });
    });

    it('pós-fixado puro: spread zero é herdado como zero, não como ausente', () => {
        // Tesouro Reserva 2036 depois da correção do parser: SELIC, sem ágio.
        const bond = { index: 'SELIC', rate: 0 };
        expect(resolveFixedIncomeIndexing({ bond })).toEqual({ index: 'SELIC', spread: 0 });
    });

    it('Tesouro Selic com ágio mínimo mantém o spread do catálogo', () => {
        const bond = { index: 'SELIC', rate: 0.073 };
        expect(resolveFixedIncomeIndexing({ bond })).toEqual({ index: 'SELIC', spread: 0.073 });
    });

    it('o que o usuário informou vence o catálogo', () => {
        const bond = { index: 'SELIC', rate: 0 };
        expect(resolveFixedIncomeIndexing({ index: 'CDI', spread: 110, bond }))
            .toEqual({ index: 'CDI', spread: 110 });
    });

    it('spread informado como 0 não é substituído pelo catálogo', () => {
        const bond = { index: 'IPCA', rate: 7.67 };
        expect(resolveFixedIncomeIndexing({ index: 'IPCA', spread: 0, bond }))
            .toEqual({ index: 'IPCA', spread: 0 });
    });

    it('prefixado não carrega spread sobre índice', () => {
        expect(resolveFixedIncomeIndexing({ bond: { index: 'PRE', rate: 14.62 } }))
            .toEqual({ index: 'PRE', spread: null });
    });

    it('sem índice reconhecível não resolve nada (o ativo fica intocado)', () => {
        expect(resolveFixedIncomeIndexing({})).toBeNull();
        expect(resolveFixedIncomeIndexing({ bond: null })).toBeNull();
        expect(resolveFixedIncomeIndexing({ index: 'OUTRO', bond: { index: 'OUTRO' } })).toBeNull();
    });
});

describe('do catálogo à curva de rendimento', () => {
    const asset = (indexing) => ({
        type: 'FIXED_INCOME',
        fixedIncomeIndex: indexing.index,
        fixedIncomeSpread: indexing.spread ?? 0,
    });

    it('Reserva 2036 (SELIC + 0) rende a Selic cheia, nem mais nem menos', () => {
        const pos = asset(resolveFixedIncomeIndexing({ bond: { index: 'SELIC', rate: 0 } }));
        expect(effectiveAnnualRate(pos, MACRO)).toBe(14);
        expect(assetDailyFactor(pos, MACRO)).toBeCloseTo(Math.pow(1.14, 1 / 252), 10);
    });

    it('o catálogo contaminado dobrava o rendimento da mesma posição', () => {
        // Como o título estava gravado antes da correção: IPCA + 14,00%.
        const contaminado = asset(resolveFixedIncomeIndexing({ bond: { index: 'IPCA', rate: 14 } }));
        const correto = asset(resolveFixedIncomeIndexing({ bond: { index: 'SELIC', rate: 0 } }));
        expect(effectiveAnnualRate(contaminado, MACRO)).toBeCloseTo(18.44, 10); // 4,44 + 14
        expect(effectiveAnnualRate(correto, MACRO)).toBe(14);
        expect(effectiveAnnualRate(contaminado, MACRO)).toBeGreaterThan(effectiveAnnualRate(correto, MACRO));
    });

    it('IPCA+ 2037: a taxa da duplicata congelada difere da linha viva', () => {
        // As duas linhas que a vitrine mostrava lado a lado, mesmo título:
        const viva = asset(resolveFixedIncomeIndexing({ bond: { index: 'IPCA', rate: 7.67 } }));
        const orfa = asset(resolveFixedIncomeIndexing({ bond: { index: 'IPCA', rate: 7.53 } }));
        expect(effectiveAnnualRate(viva, MACRO)).toBeCloseTo(12.11, 10);
        expect(effectiveAnnualRate(orfa, MACRO)).toBeCloseTo(11.97, 10);
    });
});
