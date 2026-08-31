import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CookieNotice } from './CookieNotice';
import {
    CONSENT_STORAGE_KEY,
    GA_MEASUREMENT_ID,
    resetAnalyticsConsent,
} from '../../utils/analyticsConsent';

/**
 * O banner precisa ser um PEDIDO, não um aviso.
 *
 * A versão anterior tinha um botão só ("Entendi") e dizia "sem rastreamento de
 * terceiros" — com o GA já carregado. O que se protege aqui é que exista uma
 * recusa real, do mesmo tamanho do aceite, e que nada carregue antes da escolha.
 */

vi.mock('react-router-dom', () => ({
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
    useLocation: () => ({ pathname: '/' }),
}));

const tagsDoGa = () =>
    Array.from(document.querySelectorAll('script')).filter((s) => s.src.includes('googletagmanager'));

const botao = (nome: RegExp) => screen.getByRole('button', { name: nome });

beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    delete (window as any)[`ga-disable-${GA_MEASUREMENT_ID}`];
});

describe('Primeira visita', () => {
    it('aparece e oferece as duas saídas', () => {
        render(<CookieNotice />);

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(botao(/aceitar/i)).toBeInTheDocument();
        expect(botao(/recusar/i)).toBeInTheDocument();
    });

    it('não carrega o analytics enquanto o usuário não decide', () => {
        render(<CookieNotice />);

        expect(tagsDoGa()).toHaveLength(0);
    });

    it('não afirma mais que não há rastreamento de terceiros', () => {
        // O texto antigo era falso na presença do GA — e um consentimento
        // colhido sobre informação errada não vale nada.
        render(<CookieNotice />);

        expect(screen.queryByText(/sem rastreamento/i)).not.toBeInTheDocument();
        expect(screen.getAllByText(/Google Analytics/i).length).toBeGreaterThan(0);
    });

    it('não oferece um X que feche sem escolha', () => {
        // Fechar no X seria silêncio, e silêncio não é consentimento — mas
        // também não deve valer como recusa registrada sem o usuário saber.
        render(<CookieNotice />);

        expect(screen.queryByRole('button', { name: /fechar/i })).not.toBeInTheDocument();
    });
});

describe('Escolha do usuário', () => {
    it('aceitar carrega o analytics e fecha o banner', async () => {
        render(<CookieNotice />);
        await act(async () => { await userEvent.click(botao(/aceitar/i)); });

        expect(tagsDoGa()).toHaveLength(1);
        expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('granted');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('recusar fecha o banner sem carregar nada', async () => {
        render(<CookieNotice />);
        await act(async () => { await userEvent.click(botao(/recusar/i)); });

        expect(tagsDoGa()).toHaveLength(0);
        expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('denied');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('não volta a perguntar em quem já decidiu', () => {
        localStorage.setItem(CONSENT_STORAGE_KEY, 'denied');

        render(<CookieNotice />);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('Revogação pela Política de Privacidade', () => {
    it('reabre o banner quando a escolha é apagada', async () => {
        localStorage.setItem(CONSENT_STORAGE_KEY, 'granted');
        render(<CookieNotice />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        act(() => resetAnalyticsConsent());

        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
});
