import { describe, it, expect } from 'vitest';
import { DASHBOARD_STEPS, WALLET_STEPS, TUTORIAL_TARGET_IDS } from './tutorialSteps';

const ALLOWED_TABS = ['OVERVIEW', 'PERFORMANCE', 'DIVIDENDS', 'STATEMENT'];

describe('tutorialSteps — invariantes de estrutura', () => {
    // O tour foi enxugado de 18 para 12 passos. O teto existe para impedir que o
    // fluxo volte a inchar: onboarding longo é abandonado no meio.
    it('mantém a contagem esperada de passos (7 + 5)', () => {
        expect(DASHBOARD_STEPS).toHaveLength(7);
        expect(WALLET_STEPS).toHaveLength(5);
    });

    it('nenhum alvo é destacado em dois passos seguidos do mesmo fluxo', () => {
        for (const steps of [DASHBOARD_STEPS, WALLET_STEPS]) {
            for (let i = 1; i < steps.length; i++) {
                const prev = steps[i - 1].highlightId;
                const curr = steps[i].highlightId;
                if (prev !== null && curr !== null) {
                    expect(curr, `passo ${i + 1} repete o alvo do anterior`).not.toBe(prev);
                }
            }
        }
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

    it('não sobra alvo canônico sem passo que o use', () => {
        const usados = new Set(
            [...DASHBOARD_STEPS, ...WALLET_STEPS].flatMap(s => [s.highlightId, s.mobileHighlightId]).filter(Boolean)
        );
        for (const id of TUTORIAL_TARGET_IDS) {
            expect(usados, `alvo órfão na lista canônica: ${id}`).toContain(id);
        }
    });

    it('o passo de navegação do Dashboard tem variante mobile (alvo + conteúdo)', () => {
        const navStep = DASHBOARD_STEPS.find(s => s.highlightId === 'tour-nav-links');
        expect(navStep).toBeDefined();
        expect(navStep!.mobileHighlightId).toBe('tour-nav-mobile');
        expect(navStep!.mobileContent).toBeTruthy();
    });
});
