import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Privacy } from './Privacy';
import { CONSENT_STORAGE_KEY, GA_MEASUREMENT_ID } from '../utils/analyticsConsent';

/**
 * A Política é o documento que responde por nós perante o titular e a ANPD.
 *
 * Até 30/08/2026 ela afirmava, na seção 6, que não havia "cookies de
 * rastreamento ou analytics de terceiros" — enquanto o Google Analytics
 * carregava em toda visita. Declarar a mais é omissão de tratamento; declarar
 * a menos é o que faz um consentimento ser inválido.
 */

vi.mock('react-router-dom', () => ({
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('../components/seo/PageMeta', () => ({ PageMeta: () => null }));

beforeEach(() => {
    localStorage.clear();
    delete (window as any)[`ga-disable-${GA_MEASUREMENT_ID}`];
});

describe('Seção de cookies', () => {
    it('declara o Google Analytics e a permissão que ele exige', () => {
        render(<Privacy />);

        expect(screen.getAllByText(/Google Analytics/i).length).toBeGreaterThan(0);
        expect(screen.getByText(/base legal é o consentimento/i)).toBeInTheDocument();
    });

    it('não afirma mais que não usamos analytics de terceiros', () => {
        render(<Privacy />);

        expect(screen.queryByText(/Não utilizamos cookies de rastreamento/i)).not.toBeInTheDocument();
    });

    it('separa o que é essencial do que é opcional', () => {
        // Sem essa separação, o "sempre ativo" cobriria o analytics por tabela.
        render(<Privacy />);

        expect(screen.getByText(/Essenciais \(sempre ativos\)/i)).toBeInTheDocument();
        expect(screen.getByText(/só com sua permissão/i)).toBeInTheDocument();
    });
});

describe('Revogação (Art. 18, IX)', () => {
    it('oferece um caminho para mudar a escolha', async () => {
        localStorage.setItem(CONSENT_STORAGE_KEY, 'granted');
        render(<Privacy />);

        await userEvent.click(screen.getByRole('button', { name: /alterar minha escolha/i }));

        // Revogar tem de apagar o registro E calar a tag já carregada; só uma
        // das duas coisas deixaria a coleta correndo até o próximo F5.
        expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
        expect((window as any)[`ga-disable-${GA_MEASUREMENT_ID}`]).toBe(true);
    });
});
