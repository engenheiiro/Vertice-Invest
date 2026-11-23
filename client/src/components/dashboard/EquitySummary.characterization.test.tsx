import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Caracterização do card de patrimônio do Terminal: trava o que cada ramo
 * mostra (carregando, carteira vazia, resultado +/−/0, privacidade, campos
 * ausentes, selos e tooltips) para que a quebra em partes não mude a tela.
 */
type Kpis = Record<string, unknown>;

const baseKpis = (): Kpis => ({
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
});

const { walletState } = vi.hoisted(() => ({
    walletState: {
        kpis: {} as Record<string, unknown>,
        assets: [] as unknown[],
        isPrivacyMode: false,
        isLoading: false,
        isReadOnly: false,
    },
}));

vi.mock('../../contexts/WalletContext', () => ({ useWallet: () => walletState }));
vi.mock('../../hooks/useCountUp', () => ({ useCountUp: (value: number) => value }));

import { EquitySummary } from './EquitySummary';

const setup = (kpis: Kpis = {}, flags: Partial<typeof walletState> = {}) => {
    walletState.kpis = { ...baseKpis(), ...kpis };
    walletState.isPrivacyMode = flags.isPrivacyMode ?? false;
    walletState.isLoading = flags.isLoading ?? false;
    walletState.isReadOnly = flags.isReadOnly ?? false;
    return render(<EquitySummary />);
};

/** Card (div raiz) que contém o rótulo dado. */
const card = (label: string): HTMLElement => {
    const region = screen.getByRole('region', { name: 'Resumo patrimonial' });
    const found = Array.from(region.children).find((el) =>
        Array.from(el.querySelectorAll('span')).some((span) => span.textContent === label));
    if (!(found instanceof HTMLElement)) throw new Error(`card ${label} não encontrado`);
    return found;
};

/** Classe da caixa do <FitText> (o texto mora num <span> interno). */
const boxClass = (el: HTMLElement) => el.closest('div')?.className ?? '';

const text = (label: string) => (card(label).textContent ?? '').replace(/\u00a0/g, ' ');

afterEach(() => { walletState.kpis = baseKpis(); });

describe('EquitySummary — caracterização', () => {
    it('carregando mostra o esqueleto e nenhum card', () => {
        setup({}, { isLoading: true });
        expect(screen.queryByRole('region', { name: 'Resumo patrimonial' })).not.toBeInTheDocument();
    });

    it('mostra os quatro cards com os valores do contexto', () => {
        setup();
        expect(text('Patrimônio Líquido')).toContain('R$ 22.149,42');
        expect(text('Patrimônio Líquido')).toContain('+1.34%');
        expect(text('Patrimônio Líquido')).toContain('+R$ 7,51');
        expect(text('Patrimônio Líquido')).toContain('0.03%');
        expect(text('Valor Aplicado')).toContain('R$ 21.856,44');
        expect(text('Valor Aplicado')).toContain('R$ 22.157,29');
        expect(text('Valor Aplicado')).toContain('1.01x');
        expect(text('Lucro Total')).toContain('+R$ 300,84');
        expect(text('Lucro Total')).toContain('2.03%');
        expect(text('Lucro Total')).toContain('Auditado');
        expect(text('Prov. Acumulados')).toContain('R$ 7,87');
        expect(text('Prov. Acumulados')).toContain('R$ 7,25');
        expect(text('Prov. Acumulados')).toContain('Passivo');
    });

    it('resultado positivo pinta o lucro de verde', () => {
        setup();
        expect(boxClass(within(card('Lucro Total')).getByText('+R$ 300,84'))).toContain('text-emerald-400');
    });

    it('resultado negativo pinta de vermelho e não põe "+"', () => {
        setup({ totalResult: -120.5, weightedRentability: -3.2, totalEquity: 900, totalInvested: 1000, dayVariation: -4, dayVariationPercent: -0.4 });
        const lucro = within(card('Lucro Total')).getByText('-R$ 120,50');
        expect(boxClass(lucro)).toContain('text-red-400');
        expect(text('Lucro Total')).toContain('-3.20%');
        const capital = within(card('Patrimônio Líquido')).getByText('-10.00%');
        expect(capital.className).toContain('text-[#fca5a5]');
        expect(text('Patrimônio Líquido')).toContain('-R$ 4,00');
        expect(text('Patrimônio Líquido')).toContain('-0.40%');
    });

    it('resultado zero conta como positivo ("+R$ 0,00")', () => {
        setup({ totalResult: 0, weightedRentability: 0, dayVariation: 0, dayVariationPercent: 0 });
        expect(boxClass(within(card('Lucro Total')).getByText('+R$ 0,00'))).toContain('text-emerald-400');
        expect(text('Patrimônio Líquido')).toContain('+R$ 0,00');
        expect(text('Lucro Total')).toContain('0.00%');
    });

    it('carteira vazia: nada aplicado zera variação de capital e múltiplo', () => {
        setup({
            totalEquity: 0, totalInvested: 0, totalResult: 0, dayVariation: 0, dayVariationPercent: 0,
            totalDividends: 0, projectedDividends: 0, weightedRentability: 0,
        });
        expect(text('Patrimônio Líquido')).toContain('R$ 0,00+0.00%');
        expect(text('Valor Aplicado')).toContain('0.00x');
    });

    it('campos ausentes caem em zero sem quebrar', () => {
        setup({
            totalEquity: undefined, totalInvested: undefined, totalResult: undefined, dayVariation: undefined,
            dayVariationPercent: undefined, totalDividends: undefined, projectedDividends: undefined,
            weightedRentability: undefined, dataQuality: undefined, sharpeSample: undefined,
        });
        expect(text('Patrimônio Líquido')).toContain('+0.00%');
        expect(text('Valor Aplicado')).toContain('0.00x');
        expect(text('Lucro Total')).toContain('+R$ 0,00');
        expect(text('Lucro Total')).toContain('Estimado');
    });

    it('modo privacidade mascara valores e percentuais, mas não o múltiplo', () => {
        setup({}, { isPrivacyMode: true });
        expect(text('Patrimônio Líquido')).not.toContain('22.149');
        expect(text('Patrimônio Líquido')).toContain('+•••%');
        expect(text('Lucro Total')).toContain('•••%');
        expect(text('Lucro Total')).not.toContain('300,84');
        expect(text('Valor Aplicado')).toContain('1.01x');
        expect(text('Prov. Acumulados')).not.toContain('7,87');
    });

    it('dado estimado troca o selo para amarelo', () => {
        setup({ dataQuality: 'ESTIMATED' });
        const selo = within(card('Lucro Total')).getByText('Estimado');
        expect(selo.className).toContain('bg-yellow-500/10');
        expect(within(card('Lucro Total')).queryByText('Auditado')).not.toBeInTheDocument();
    });

    it('selo auditado é verde', () => {
        setup();
        expect(within(card('Lucro Total')).getByText('Auditado').className).toContain('bg-emerald-500/10');
    });

    it('sem Sharpe o selo de risco some; com Sharpe aparece com tooltip', () => {
        const { unmount } = setup();
        expect(card('Lucro Total').querySelector('[title^="Índice de Sharpe"]')).toBeNull();
        unmount();

        setup({ sharpeRatio: 0.84, sharpeConfidence: 'LOW', sharpeStandardError: 1.2, sharpeSample: 40 });
        const badge = card('Lucro Total').querySelector('[title^="Índice de Sharpe"]');
        expect(badge?.textContent).toContain('~0,84');
        expect(badge?.getAttribute('title')).toContain('medido sobre 40 pregões');
        expect(badge?.getAttribute('title')).toContain('±1,20');
    });

    it('modo demo (KPIs do contexto com Sharpe 1,8 auditado) mostra o selo de risco sem "~"', () => {
        setup({ sharpeRatio: 1.8, dataQuality: 'AUDITED' });
        const badge = card('Lucro Total').querySelector('[title^="Índice de Sharpe"]');
        expect(badge?.textContent?.trim()).toBe('1,80');
        expect(text('Lucro Total')).toContain('Auditado');
    });

    it('cada card de indicador traz o tooltip explicativo', () => {
        setup();
        expect(text('Valor Aplicado')).toContain('Custo Contábil');
        expect(text('Lucro Total')).toContain('ganho de capital');
        expect(text('Prov. Acumulados')).toContain('Média Mensal Est. é quanto');
        expect(card('Patrimônio Líquido').querySelector('[title^="Variação do capital"]')).not.toBeNull();
    });

    it('modo leitura mostra a variação do dia como texto, sem botão', () => {
        setup({}, { isReadOnly: true });
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(text('Patrimônio Líquido')).toContain('+R$ 7,51');
    });

    it('botão do dia abre o detalhamento', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: /variação de hoje/i }));
        expect(screen.getByText('O dia da sua carteira')).toBeInTheDocument();
    });

    it('não tem violação de acessibilidade', async () => {
        const { container } = setup();
        expect(await axe(container)).toHaveNoViolations();
    });
});
