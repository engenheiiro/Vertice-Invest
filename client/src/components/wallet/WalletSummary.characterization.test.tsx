import React from 'react';
import { createHash } from 'node:crypto';
import { fireEvent, render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Caracterização do resumo da aba Carteira: o HTML de cada ramo (carregando,
 * resultado +/−/0, sem aporte, campos ausentes, selos, privacidade, link
 * público, valores travados, tooltip aberto) vira um resumo sha256 travado
 * para que a quebra em partes não mude um caractere da tela.
 */
type Kpis = Record<string, unknown>;

const baseKpis = (): Kpis => ({
    totalEquity: 22149.42, totalInvested: 21856.44, totalResult: 300.84, totalResultPercent: 1.38,
    dayVariation: 7.51, dayVariationPercent: 0.03, totalDividends: 7.87, projectedDividends: 7.25,
    weightedRentability: 2.03, dataQuality: 'AUDITED',
    sharpeRatio: null, sharpeConfidence: null, sharpeStandardError: null, sharpeSample: 22, beta: null,
});

const { walletState } = vi.hoisted(() => ({
    walletState: {
        kpis: {} as Record<string, unknown>,
        assets: [] as unknown[],
        isPrivacyMode: false,
        togglePrivacyMode: () => undefined,
        isLoading: false,
        isValuesLocked: false,
        isReadOnly: false,
    },
}));

vi.mock('../../contexts/WalletContext', () => ({ useWallet: () => walletState }));
vi.mock('../../hooks/useCountUp', () => ({ useCountUp: (value: number) => value }));

import { WalletSummary } from './WalletSummary';

type Flags = { isPrivacyMode?: boolean; isLoading?: boolean; isReadOnly?: boolean; isValuesLocked?: boolean };

const setup = (kpis: Kpis = {}, flags: Flags = {}) => {
    walletState.kpis = { ...baseKpis(), ...kpis };
    walletState.isPrivacyMode = flags.isPrivacyMode ?? false;
    walletState.isLoading = flags.isLoading ?? false;
    walletState.isReadOnly = flags.isReadOnly ?? false;
    walletState.isValuesLocked = flags.isValuesLocked ?? false;
    return render(<WalletSummary />);
};

const digest = (html: string) => createHash('sha256').update(html).digest('hex').slice(0, 16);

const CENARIOS: Array<[string, Kpis, Flags]> = [
    ['base', {}, {}],
    ['carregando', {}, { isLoading: true }],
    ['tudo negativo', { totalEquity: 20000, totalResult: -1856.44, dayVariation: -12.3, dayVariationPercent: -0.06, weightedRentability: -4.1 }, {}],
    ['dia zerado', { dayVariation: 0, dayVariationPercent: 0 }, {}],
    ['sem aporte', { totalEquity: 0, totalInvested: 0, totalResult: 0 }, {}],
    ['campos ausentes', { dayVariation: undefined, dayVariationPercent: undefined, weightedRentability: undefined, totalDividends: undefined }, {}],
    ['estimado com sharpe', { dataQuality: 'ESTIMATED', sharpeRatio: 1.234, sharpeConfidence: 'LOW', sharpeStandardError: 0.4, sharpeSample: 40 }, {}],
    ['privacidade', {}, { isPrivacyMode: true }],
    ['link público', {}, { isReadOnly: true }],
    ['valores travados', {}, { isReadOnly: true, isValuesLocked: true }],
];

afterEach(() => { walletState.kpis = baseKpis(); });

describe('WalletSummary — caracterização', () => {
    it.each(CENARIOS)('%s', (_nome, kpis, flags) => {
        const { container } = setup(kpis, flags);
        expect(digest(container.innerHTML)).toMatchSnapshot();
    });

    it('tooltip aberto em portal e o modal do dia', () => {
        const { container } = setup();
        const gatilho = container.querySelector<HTMLButtonElement>('[data-tooltip-trigger]');
        if (!gatilho) throw new Error('sem tooltip');
        fireEvent.focus(gatilho);
        expect(digest(document.body.innerHTML)).toMatchSnapshot();
        fireEvent.blur(gatilho);
        const botaoDia = container.querySelector<HTMLButtonElement>('button[aria-label="Ver de quais ativos veio a variação de hoje"]');
        if (!botaoDia) throw new Error('sem botão do dia');
        fireEvent.click(botaoDia);
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('sem violações de acessibilidade', async () => {
        const { container } = setup();
        expect(await axe(container)).toHaveNoViolations();
    });
});
