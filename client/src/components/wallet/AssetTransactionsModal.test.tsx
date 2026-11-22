import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetTransactionsModal } from './AssetTransactionsModal';
import { walletService } from '../../services/wallet';

const wallet = { privacy: false };
vi.mock('../../contexts/WalletContext', () => ({
    useWallet: () => ({
        refreshWallet: vi.fn(),
        assets: [{ ticker: 'PETR4', type: 'STOCK' }],
        activeWalletId: 'w1',
        isWalletScopeReady: true,
        isPrivacyMode: wallet.privacy,
    }),
}));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
const demo = { on: false };
vi.mock('../../contexts/DemoContext', () => ({ useDemo: () => ({ isDemoMode: demo.on }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));
vi.mock('../../services/wallet', () => ({
    walletService: { getTransactions: vi.fn(), deleteTransaction: vi.fn() },
}));

const page = (n: number, hasMore: boolean) => ({
    transactions: [{ _id: `t${n}`, type: 'BUY', quantity: 100, price: 30.5, totalValue: 3050, date: '2024-03-15', currency: 'BRL' }],
    pagination: { hasMore },
});

const renderModal = (client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) =>
    render(
        <QueryClientProvider client={client}>
            <AssetTransactionsModal isOpen onClose={() => {}} ticker="PETR4" />
        </QueryClientProvider>
    );

beforeEach(() => {
    vi.clearAllMocks();
    demo.on = false;
    wallet.privacy = false;
});

describe('AssetTransactionsModal — modo demo', () => {
    // Durante o tour os ativos são fictícios: o extrato não pode ir à API (traria
    // e permitiria apagar movimentações REAIS de um ticker homônimo).
    it('não busca o extrato real e mostra lista vazia', async () => {
        demo.on = true;
        renderModal();
        expect(await screen.findByText('Nenhuma transação encontrada.')).toBeInTheDocument();
        expect(walletService.getTransactions).not.toHaveBeenCalled();
        expect(walletService.deleteTransaction).not.toHaveBeenCalled();
    });
});

describe('AssetTransactionsModal — extrato via React Query', () => {
    it('busca com escopo de carteira e pagina pelo "Carregar mais"', async () => {
        vi.mocked(walletService.getTransactions)
            .mockResolvedValueOnce(page(1, true))
            .mockResolvedValueOnce(page(2, false));
        renderModal();
        expect(await screen.findByText('R$ 3.050,00')).toBeInTheDocument();
        expect(walletService.getTransactions).toHaveBeenCalledWith('PETR4', 1, 10, 'w1');

        fireEvent.click(screen.getByText('Carregar Mais Antigas'));
        await waitFor(() => expect(walletService.getTransactions).toHaveBeenCalledWith('PETR4', 2, 10, 'w1'));
        await waitFor(() => expect(screen.getAllByText('R$ 3.050,00')).toHaveLength(2));
        expect(screen.queryByText('Carregar Mais Antigas')).not.toBeInTheDocument();
    });

    it('modo privacidade mascara preço, total e quantidade', async () => {
        wallet.privacy = true;
        vi.mocked(walletService.getTransactions).mockResolvedValue(page(1, false));
        renderModal();
        await screen.findByText('Compra');
        expect(screen.queryByText(/3\.050/)).not.toBeInTheDocument();
        expect(screen.queryByText(/30,50/)).not.toBeInTheDocument();
        expect(screen.getAllByText(/••••••/).length).toBeGreaterThanOrEqual(2);
    });
});
