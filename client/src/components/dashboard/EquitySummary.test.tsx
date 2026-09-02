import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * O card de patrimônio do Terminal é irmão do da Carteira: mesmo conteúdo, mesmo
 * contexto, grid diferente. O detalhamento do dia tem de estar nos DOIS — é a
 * razão de o botão viver no card e não numa seção da página da Carteira.
 */
const { walletState } = vi.hoisted(() => ({
    walletState: {
        kpis: {
            totalEquity: 22149.42,
            totalInvested: 21856.44,
            totalResult: 300.84,
            totalResultPercent: 1.38,
            dayVariation: 7.51,
            dayVariationPercent: 0.03,
            dayAnchorDate: '2026-08-31',
            dayDividends: 0,
            totalDividends: 7.87,
            projectedDividends: 7.25,
            weightedRentability: 2.03,
            dataQuality: 'AUDITED',
            sharpeRatio: null,
            sharpeConfidence: null,
            sharpeStandardError: null,
            sharpeSample: 22,
            beta: null,
        },
        assets: [
            {
                id: 'a1', ticker: 'PETR4', name: 'Petrobras', type: 'STOCK',
                quantity: 100, averagePrice: 30, currentPrice: 32,
                totalValue: 3200, totalCost: 3000, profit: 200, profitPercent: 6.67,
                currency: 'BRL', dayChangeValue: 7.51, dayChangePct: 0.24,
                dayChangeReason: 'ANCHOR_CLOSE',
            },
        ],
        isPrivacyMode: false,
        isLoading: false,
        isReadOnly: false,
    },
}));

vi.mock('../../contexts/WalletContext', () => ({ useWallet: () => walletState }));
vi.mock('../../hooks/useCountUp', () => ({ useCountUp: (value: number) => value }));

import { EquitySummary } from './EquitySummary';

afterEach(() => { walletState.isReadOnly = false; });

describe('EquitySummary', () => {
    it('abre o mesmo detalhamento do dia que a Carteira', () => {
        render(<EquitySummary />);

        expect(screen.getByText('Variação Hoje')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /variação de hoje/i }));

        expect(screen.getByText('O dia da sua carteira')).toBeInTheDocument();
        expect(screen.getByText(/desde o fechamento de segunda-feira, 31\/08/)).toBeInTheDocument();
        expect(screen.getByText('PETR4')).toBeInTheDocument();
    });

    it('some no modo leitura, como na Carteira', () => {
        walletState.isReadOnly = true;
        render(<EquitySummary />);

        expect(screen.queryByRole('button', { name: /variação de hoje/i })).not.toBeInTheDocument();
    });
});
