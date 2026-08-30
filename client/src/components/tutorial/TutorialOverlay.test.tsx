import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Controles mockáveis do contexto de demo, roteamento e viewport.
const demo = vi.hoisted(() => ({
    isDemoMode: true,
    currentStep: 0,
    nextStep: vi.fn(),
    prevStep: vi.fn(),
    skipTutorial: vi.fn(),
    resetStep: vi.fn(),
}));
const nav = vi.hoisted(() => ({ navigate: vi.fn(), pathname: '/dashboard' }));
const mobile = vi.hoisted(() => ({ value: false }));

vi.mock('../../contexts/DemoContext', () => ({ useDemo: () => demo }));
vi.mock('react-router-dom', () => ({
    useNavigate: () => nav.navigate,
    useLocation: () => ({ pathname: nav.pathname }),
}));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));

import { TutorialOverlay } from './TutorialOverlay';
import { DASHBOARD_STEPS, WALLET_STEPS } from './tutorialSteps';

beforeEach(() => {
    demo.isDemoMode = true;
    demo.currentStep = 0;
    demo.nextStep.mockClear();
    demo.prevStep.mockClear();
    demo.skipTutorial.mockClear();
    demo.resetStep.mockClear();
    nav.navigate.mockClear();
    nav.pathname = '/dashboard';
    mobile.value = false;
});

describe('TutorialOverlay — renderização', () => {
    it('não renderiza nada fora do modo demo', () => {
        demo.isDemoMode = false;
        render(<TutorialOverlay />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renderiza o passo atual como diálogo acessível', () => {
        render(<TutorialOverlay />);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByText(DASHBOARD_STEPS[0].title)).toBeInTheDocument();
    });

    it('renderiza centralizado (sem quebrar) quando o alvo está ausente/oculto', () => {
        // O passo de navegação aponta para #tour-nav-links, ausente no DOM de teste.
        const navIndex = DASHBOARD_STEPS.findIndex(s => s.highlightId === 'tour-nav-links');
        demo.currentStep = navIndex;
        render(<TutorialOverlay />);
        expect(screen.getByText(DASHBOARD_STEPS[navIndex].title)).toBeInTheDocument();
    });
});

describe('TutorialOverlay — navegação', () => {
    it('"Próximo" avança o passo', async () => {
        render(<TutorialOverlay />);
        await userEvent.click(screen.getByText('Próximo'));
        expect(demo.nextStep).toHaveBeenCalledTimes(1);
    });

    it('não mostra "Voltar" no primeiro passo', () => {
        render(<TutorialOverlay />);
        expect(screen.queryByText('Voltar')).toBeNull();
    });

    it('mostra e aciona "Voltar" a partir do segundo passo', async () => {
        demo.currentStep = 1;
        render(<TutorialOverlay />);
        await userEvent.click(screen.getByText('Voltar'));
        expect(demo.prevStep).toHaveBeenCalledTimes(1);
    });

    it('passo final do Dashboard reseta e navega para a Carteira', async () => {
        demo.currentStep = DASHBOARD_STEPS.length - 1;
        nav.pathname = '/dashboard';
        render(<TutorialOverlay />);
        await userEvent.click(screen.getByText('Sim, continuar'));
        expect(demo.resetStep).toHaveBeenCalledTimes(1);
        expect(nav.navigate).toHaveBeenCalledWith('/wallet');
    });

    // A casa é a Carteira: o passo final encerra o demo SEM tirar o usuário dela.
    it('passo final da Carteira encerra o demo e permanece na Carteira', async () => {
        demo.currentStep = WALLET_STEPS.length - 1;
        nav.pathname = '/wallet';
        render(<TutorialOverlay />);
        await userEvent.click(screen.getByText('Concluir Demo'));
        expect(demo.skipTutorial).toHaveBeenCalledTimes(1);
        expect(nav.navigate).toHaveBeenCalledWith('/wallet');
    });
});

describe('TutorialOverlay — teclado', () => {
    it('Escape encerra o tutorial', () => {
        render(<TutorialOverlay />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(demo.skipTutorial).toHaveBeenCalledTimes(1);
    });

    it('ArrowRight avança', () => {
        render(<TutorialOverlay />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(demo.nextStep).toHaveBeenCalledTimes(1);
    });

    it('ArrowLeft não retrocede no primeiro passo', () => {
        render(<TutorialOverlay />);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(demo.prevStep).not.toHaveBeenCalled();
    });

    it('ArrowLeft retrocede a partir do segundo passo', () => {
        demo.currentStep = 1;
        render(<TutorialOverlay />);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(demo.prevStep).toHaveBeenCalledTimes(1);
    });
});

describe('TutorialOverlay — variante mobile', () => {
    it('usa o conteúdo mobile no passo de navegação quando em mobile', () => {
        const navIndex = DASHBOARD_STEPS.findIndex(s => s.highlightId === 'tour-nav-links');
        nav.pathname = '/dashboard';

        // Desktop e mobile renderizam textos DIFERENTES no mesmo passo — sem depender
        // de frase literal, que quebra a cada ajuste de copy.
        mobile.value = false;
        const desktopText = render(<TutorialOverlay />).container.textContent;
        cleanup();

        mobile.value = true;
        demo.currentStep = navIndex;
        const mobileText = render(<TutorialOverlay />).container.textContent;

        expect(mobileText).not.toBe(desktopText);
        expect(mobileText).toMatch(/polegar|embaixo/i);
    });
});

describe('TutorialOverlay — rotas sem alvo', () => {
    it('não renderiza fora do Terminal e da Carteira', () => {
        // Sem esse guard, ligar o demo em /research (ou pelo painel Admin) mostrava
        // passos do Dashboard apontando para elementos que não existem na página.
        nav.pathname = '/research';
        render(<TutorialOverlay />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renderiza na Carteira com o fluxo da Carteira', () => {
        nav.pathname = '/wallet';
        render(<TutorialOverlay />);
        expect(screen.getByText(WALLET_STEPS[0].title)).toBeInTheDocument();
    });
});
