import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { useWallet } from '../../contexts/WalletContext';
import { useDemo } from '../../contexts/DemoContext';
import { CashFlowHistory } from './CashFlowHistory';

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: vi.fn() }));

const renderSubject = () => {
    vi.mocked(useWallet).mockReturnValue({
        activeWalletId: 'demo',
        isWalletScopeReady: true,
        isPrivacyMode: false,
        dataSource: { getCashFlow: vi.fn() },
    } as any);
    vi.mocked(useDemo).mockReturnValue({ isDemoMode: true } as any);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <CashFlowHistory />
        </QueryClientProvider>,
    );
};

describe('CashFlowHistory — filtros por tipo', () => {
    it('oferece filtros detalhados e filtra as transações demo', async () => {
        renderSubject();

        ['Tudo', 'Reserva', 'Investimentos']
            .forEach(label => expect(screen.getByRole('button', { name: label })).toBeInTheDocument());
        const categoryButton = screen.getByRole('button', { name: 'Categoria de investimento: Categoria' });
        fireEvent.click(categoryButton);
        ['Todas as categorias', 'Ações', 'FIIs', 'ETFs', 'Cripto', 'Renda Fixa', 'Exterior', 'Ouro']
            .forEach(label => expect(screen.getByRole('option', { name: label })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('option', { name: 'Ações' }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Investimentos' })).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByText('Compra de SBSP3')).toBeInTheDocument();
            expect(screen.getByText('Compra de WEGE3')).toBeInTheDocument();
            expect(screen.queryByText('Compra de NVDA')).not.toBeInTheDocument();
            expect(screen.queryByText('Compra de TESOURO SELIC')).not.toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Categoria de investimento: Ações' }));
        fireEvent.click(screen.getByRole('option', { name: 'ETFs' }));
        expect(await screen.findByText('Nenhum registro encontrado.')).toBeInTheDocument();
    });
});
