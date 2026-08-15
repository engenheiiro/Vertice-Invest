import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Asset } from '../../contexts/WalletContext';
import { SectorPopover } from './SectorPopover';

// jsdom não implementa ResizeObserver — usado pelo ResponsiveContainer do recharts.
(global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const fii = (ticker: string, totalValue: number, sector?: string): Asset => ({
    id: ticker,
    ticker,
    type: 'FII',
    quantity: 1,
    averagePrice: totalValue,
    currentPrice: totalValue,
    totalValue,
    totalCost: totalValue,
    profit: 0,
    profitPercent: 0,
    currency: 'BRL',
    sector,
} as unknown as Asset);

const items = [
    fii('VISC11', 600, 'Shoppings'),
    fii('HGLG11', 300, 'Logística'),
    fii('KNCR11', 100, 'Títulos e Val. Mob.'),
];

describe('SectorPopover — FIIs', () => {
    it('não renderiza o chip quando não há saldo em FII', () => {
        render(<SectorPopover items={[fii('VISC11', 0, 'Shoppings')]} kind="FII" />);
        expect(screen.queryByRole('button', { name: /setores/i })).not.toBeInTheDocument();
    });

    it('abre no hover e lista os segmentos com o percentual', async () => {
        const user = userEvent.setup();
        render(<SectorPopover items={items} kind="FII" />);

        const trigger = screen.getByRole('button', { name: /setores/i });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await user.hover(trigger);

        const popover = await screen.findByRole('dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(popover).toHaveTextContent('Shoppings');
        expect(popover).toHaveTextContent('60.0%');
        expect(popover).toHaveTextContent('Logística');
        expect(popover).toHaveTextContent('30.0%');
        // Sinônimo do Fundamentus normalizado para o rótulo de carteira.
        expect(popover).toHaveTextContent('Papel (CRI)');
        expect(popover).toHaveTextContent('10.0%');
    });

    it('fecha ao tirar o mouse, mas não quando o clique fixa o popover', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <SectorPopover items={items} kind="FII" />
                <span data-testid="fora">fora</span>
            </div>,
        );
        const trigger = screen.getByRole('button', { name: /setores/i });

        await user.hover(trigger);
        const popover = await screen.findByRole('dialog');
        await user.unhover(trigger);
        await waitForElementToBeRemoved(popover);

        // Clique fixa: sair com o mouse não fecha mais.
        await user.click(trigger);
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        await user.unhover(trigger);
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        // Clique fora encerra.
        await user.click(screen.getByTestId('fora'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('mascara os valores em R$ no modo privacidade, mantendo os percentuais', async () => {
        const user = userEvent.setup();
        render(<SectorPopover items={items} kind="FII" isPrivacyMode />);

        await user.hover(screen.getByRole('button', { name: /setores/i }));
        const popover = await screen.findByRole('dialog');

        expect(popover).toHaveTextContent('60.0%');
        expect(popover.textContent).not.toMatch(/R\$/);
    });
});

describe('SectorPopover — Ações', () => {
    const stock = (ticker: string, totalValue: number, sector?: string, type = 'STOCK'): Asset => ({
        ...fii(ticker, totalValue, sector),
        type,
    } as unknown as Asset);

    it('titula como ações e agrupa pelo macro-setor', async () => {
        const user = userEvent.setup();
        render(
            <SectorPopover
                kind="STOCK"
                items={[
                    stock('ITUB4', 300, 'Bancos'),
                    stock('BBSE3', 300, 'Seguros'),
                    stock('TAEE11', 300, 'Energia Elétrica'),
                    stock('BOVA11', 100, 'Índice Amplo', 'ETF'),
                ]}
            />,
        );

        await user.hover(screen.getByRole('button', { name: /setores/i }));
        const popover = await screen.findByRole('dialog');

        expect(popover).toHaveTextContent('Ações por setor');
        // Bancos + Seguros colapsam num único macro-setor: 60% do grupo.
        expect(popover).toHaveTextContent('Financeiro');
        expect(popover).toHaveTextContent('60.0%');
        expect(popover).not.toHaveTextContent('Bancos');
        // ETF de índice não é atribuído a nenhum setor.
        expect(popover).toHaveTextContent('ETFs / Índices');
    });

    it('lista os tickers da fatia no title da legenda', async () => {
        const user = userEvent.setup();
        render(<SectorPopover kind="STOCK" items={[stock('ITUB4', 300, 'Bancos'), stock('BBSE3', 100, 'Seguros')]} />);

        await user.hover(screen.getByRole('button', { name: /setores/i }));
        const popover = await screen.findByRole('dialog');

        expect(popover.querySelector('[title]')).toHaveAttribute('title', 'Financeiro — ITUB4, BBSE3');
    });
});
