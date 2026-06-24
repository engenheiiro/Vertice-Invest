import { describe, it, expect } from 'vitest';
import { DASHBOARD_STEPS, WALLET_STEPS, TUTORIAL_TARGET_IDS } from './tutorialSteps';

const ALLOWED_TABS = ['OVERVIEW', 'PERFORMANCE', 'DIVIDENDS', 'STATEMENT'];

describe('tutorialSteps — invariantes de estrutura', () => {
    it('mantém a contagem esperada de passos (9 + 9)', () => {
        expect(DASHBOARD_STEPS).toHaveLength(9);
        expect(WALLET_STEPS).toHaveLength(9);
    });

    it('cada fluxo tem exatamente um passo final, e é o último', () => {
        for (const steps of [DASHBOARD_STEPS, WALLET_STEPS]) {
            const finals = steps.filter(s => s.isFinal);
            expect(finals).toHaveLength(1);
            expect(steps[steps.length - 1].isFinal).toBe(true);
        }
    });

    it('todo highlightId é null ou pertence à lista canônica de alvos', () => {
        for (const steps of [DASHBOARD_STEPS, WALLET_STEPS]) {
            for (const step of steps) {
                if (step.highlightId !== null) {
                    expect(TUTORIAL_TARGET_IDS).toContain(step.highlightId);
                }
            }
        }
    });

    it('todo mobileHighlightId (quando definido) pertence à lista canônica', () => {
        for (const steps of [DASHBOARD_STEPS, WALLET_STEPS]) {
            for (const step of steps) {
                if (step.mobileHighlightId) {
                    expect(TUTORIAL_TARGET_IDS).toContain(step.mobileHighlightId);
                }
            }
        }
    });

    it('toda aba declarada na Carteira é um valor permitido', () => {
        for (const step of WALLET_STEPS) {
            if (step.tab) {
                expect(ALLOWED_TABS).toContain(step.tab);
            }
        }
    });

    it('todo passo tem título, badge, ícone e conteúdo', () => {
        for (const steps of [DASHBOARD_STEPS, WALLET_STEPS]) {
            for (const step of steps) {
                expect(step.title).toBeTruthy();
                expect(step.badge).toBeTruthy();
                expect(step.icon).toBeTruthy();
                expect(step.content).toBeTruthy();
            }
        }
    });

    it('o passo de navegação do Dashboard tem variante mobile (alvo + conteúdo)', () => {
        const navStep = DASHBOARD_STEPS.find(s => s.highlightId === 'tour-nav-links');
        expect(navStep).toBeDefined();
        expect(navStep!.mobileHighlightId).toBe('tour-nav-mobile');
        expect(navStep!.mobileContent).toBeTruthy();
    });
});
