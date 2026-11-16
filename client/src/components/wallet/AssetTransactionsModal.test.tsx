import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssetTransactionsModal } from './AssetTransactionsModal';
import { walletService } from '../../services/wallet';

vi.mock('../../contexts/WalletContext', () => ({
    useWallet: () => ({ refreshWallet: vi.fn(), assets: [{ ticker: 'PETR4', type: 'STOCK' }], activeWalletId: 'w1' }),
}));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../../contexts/DemoContext', () => ({ useDemo: () => ({ isDemoMode: true }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));
vi.mock('../../services/wallet', () => ({
    walletService: { getTransactions: vi.fn(), deleteTransaction: vi.fn() },
}));

describe('AssetTransactionsModal — modo demo', () => {
    // Durante o tour os ativos são fictícios: o extrato não pode ir à API (traria
    // e permitiria apagar movimentações REAIS de um ticker homônimo).
    it('não busca o extrato real e mostra lista vazia', async () => {
        render(<AssetTransactionsModal isOpen onClose={() => {}} ticker="PETR4" />);
        expect(await screen.findByText('Nenhuma transação encontrada.')).toBeInTheDocument();
        expect(walletService.getTransactions).not.toHaveBeenCalled();
        expect(walletService.deleteTransaction).not.toHaveBeenCalled();
    });
});
