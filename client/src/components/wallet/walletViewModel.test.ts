import { describe, it, expect } from 'vitest';
import { getWalletAccess, walletSubtitle, usdBadgeText, tourLayerClass, tutorialTab, wantsDividendGoalEditor } from './walletViewModel';
import { WALLET_STEPS } from '../tutorial/tutorialSteps';
import type { UserPlan } from '../../contexts/AuthContext';

const user = (plan: UserPlan, role: 'USER' | 'ADMIN' = 'USER') => ({ plan, role });

describe('getWalletAccess', () => {
    it.each<[UserPlan, boolean, boolean, boolean, boolean, boolean]>([
        // plano, IR, proventos, aporte, rebalanceamento, cadeado do aporte
        ['GUEST', false, false, false, false, true],
        ['ESSENTIAL', false, true, false, false, true],
        ['PRO', false, true, true, false, false],
        ['ELITE', true, true, true, true, false],
        ['BLACK', true, true, true, true, false],
    ])('plano %s', (plan, tax, dividends, smart, rebalance, smartLocked) => {
        expect(getWalletAccess(user(plan), false)).toEqual({
            canAccessTax: tax, canAccessDividends: dividends, canSmartContribute: smart, canRebalance: rebalance, smartLocked,
        });
    });

    it('ADMIN abre IR e Proventos em qualquer plano, mas não aporte nem rebalanceamento', () => {
        const access = getWalletAccess(user('GUEST', 'ADMIN'), false);
        expect(access.canAccessTax).toBe(true);
        expect(access.canAccessDividends).toBe(true);
        expect(access.canSmartContribute).toBe(false);
        expect(access.canRebalance).toBe(false);
    });

    it('link público: Proventos sempre abre, IR nunca (nem para ADMIN ELITE)', () => {
        expect(getWalletAccess(null, true).canAccessDividends).toBe(true);
        expect(getWalletAccess(user('ELITE', 'ADMIN'), true).canAccessTax).toBe(false);
    });

    it('sem usuário vale GUEST, mas o cadeado do aporte não aparece (plano desconhecido)', () => {
        const access = getWalletAccess(undefined, false);
        expect(access.canAccessDividends).toBe(false);
        expect(access.canSmartContribute).toBe(false);
        expect(access.canRebalance).toBe(false);
        expect(access.smartLocked).toBe(false);
    });
});

describe('walletSubtitle', () => {
    it('logado: frase de gestão', () => {
        expect(walletSubtitle(false, 'Ana')).toBe('Gerencie seus ativos e acompanhe a evolução patrimonial.');
    });
    it('leitura com e sem dono', () => {
        expect(walletSubtitle(true, 'Ana')).toBe('Carteira compartilhada por Ana. Os dados são os mesmos que o investidor acompanha.');
        expect(walletSubtitle(true, '')).toBe('Carteira compartilhada. Os dados são os mesmos que o investidor acompanha.');
        expect(walletSubtitle(true)).toBe('Carteira compartilhada. Os dados são os mesmos que o investidor acompanha.');
    });
});

describe('usdBadgeText', () => {
    it('formata com duas casas', () => expect(usdBadgeText(5.006)).toBe('USD/BRL R$5.01'));
    it.each([null, undefined, 0, -2])('some sem taxa positiva (%s)', (rate) => expect(usdBadgeText(rate)).toBeNull());
});

describe('tourLayerClass', () => {
    it('sobe a camada no tutorial', () => expect(tourLayerClass(true)).toBe('relative z-[100]'));
    it('fora do tutorial não emite a classe literal "false" (emitia)', () => expect(tourLayerClass(false)).toBe(''));
});

describe('tutorialTab', () => {
    it('usa o tab do passo e prende o índice no último passo', () => {
        expect(tutorialTab(0)).toBe(WALLET_STEPS[0].tab ?? 'OVERVIEW');
        expect(tutorialTab(999)).toBe(WALLET_STEPS[WALLET_STEPS.length - 1].tab ?? 'OVERVIEW');
    });
});

describe('wantsDividendGoalEditor', () => {
    it('lê o flag do state de navegação', () => {
        expect(wantsDividendGoalEditor({ openDividendGoalEditor: true })).toBe(true);
        expect(wantsDividendGoalEditor({ openDividendGoalEditor: false })).toBe(false);
        expect(wantsDividendGoalEditor(null)).toBe(false);
        expect(wantsDividendGoalEditor(undefined)).toBe(false);
    });
});
