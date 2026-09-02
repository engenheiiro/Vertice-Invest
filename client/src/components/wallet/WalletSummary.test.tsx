import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { walletState } = vi.hoisted(() => ({
    walletState: {
        kpis: {
            totalEquity: 22149.42,
            totalInvested: 21856.44,
            totalResult: 300.84,
            totalResultPercent: 1.38,
            dayVariation: 7.51,
            dayVariationPercent: 0.03,
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
        isPrivacyMode: false,
        togglePrivacyMode: vi.fn(),
        isLoading: false,
        isValuesLocked: false,
    },
}));

vi.mock('../../contexts/WalletContext', () => ({ useWallet: () => walletState }));
vi.mock('../../hooks/useCountUp', () => ({ useCountUp: (value: number) => value }));

import { WalletSummary } from './WalletSummary';

describe('WalletSummary', () => {
    it('explica a Variação Hoje com texto curto e simples', () => {
        render(<WalletSummary />);

        expect(screen.getByText('Variação Hoje')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Ganho ou perda desde o fechamento anterior.' })).toBeInTheDocument();
    });

    it('renderiza os quatro tooltips em portal para não serem cortados pelos cards', () => {
        render(<WalletSummary />);

        const triggers = document.querySelectorAll<HTMLButtonElement>('[data-tooltip-trigger]');
        expect(triggers).toHaveLength(4);
        triggers.forEach((trigger) => {
            fireEvent.mouseEnter(trigger);
            expect(screen.getByRole('tooltip')).toHaveClass('fixed', 'z-[200]');
            expect(screen.getByRole('tooltip').parentElement).toBe(document.body);
            fireEvent.mouseLeave(trigger);
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        });
    });

    it('usa a mesma identidade canônica do gráfico para o saldo total', () => {
        render(<WalletSummary />);

        expect(screen.getByText('Aplicado + Resultado')).toBeInTheDocument();
        expect(screen.getByText(/22\.157,28/)).toBeInTheDocument();
        expect(screen.queryByText(/22\.157,29/)).not.toBeInTheDocument();
    });
});
