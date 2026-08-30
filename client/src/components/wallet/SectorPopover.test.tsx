import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

describe('SectorPopover — Renda Fixa', () => {
    const rf = (ticker: string, totalValue: number, extra: Record<string, unknown>): Asset => ({
        ...fii(ticker, totalValue),
        type: 'FIXED_INCOME',
        ...extra,
    } as unknown as Asset);

    it('reparte por indexador e chama o gatilho de "Indexador", não de "Setores"', async () => {
        const user = userEvent.setup();
        render(
            <SectorPopover
                kind="FIXED_INCOME"
                items={[
                    rf('TESOURO IPCA+ 2035', 600, { fixedIncomeIndex: 'IPCA' }),
                    rf('TESOURO SELIC 2029', 400, { fixedIncomeIndex: 'SELIC' }),
                ]}
            />,
        );

        // Renda Fixa não se reparte por setor: o vocabulário do chip acompanha.
        expect(screen.queryByRole('button', { name: /setores/i })).not.toBeInTheDocument();

        await user.hover(screen.getByRole('button', { name: /indexador/i }));
        const popover = await screen.findByRole('dialog');

        expect(popover).toHaveTextContent('Renda Fixa por indexador');
        expect(popover).toHaveTextContent('IPCA');
        expect(popover).toHaveTextContent('60.0%');
        expect(popover).toHaveTextContent('Pós-fixado');
        expect(popover).toHaveTextContent('40.0%');
    });
});

describe('SectorPopover — filtro de ETFs em Ações BR', () => {
    const stock = (ticker: string, totalValue: number, sector?: string, type = 'STOCK'): Asset => ({
        ...fii(ticker, totalValue, sector),
        type,
    } as unknown as Asset);

    const mixed = [
        stock('ITUB4', 300, 'Bancos'),
        stock('PETR4', 100, 'Petróleo, Gás e Biocombustíveis'),
        stock('BOVA11', 600, 'Índice Amplo', 'ETF'),
    ];

    it('rebaseia os percentuais sobre as ações individuais ao ocultar os ETFs', async () => {
        const user = userEvent.setup();
        render(<SectorPopover kind="STOCK" items={mixed} />);

        // Clique fixa o popover: o ponteiro precisa entrar nele para usar o filtro.
        await user.click(screen.getByRole('button', { name: /setores/i }));
        const popover = await screen.findByRole('dialog');

        // Com o ETF na conta ele domina o donut e achata os setores reais.
        expect(popover).toHaveTextContent('ETFs / Índices');
        expect(popover).toHaveTextContent('60.0%');
        expect(popover).toHaveTextContent('30.0%');
        expect(popover).toHaveTextContent('% do total em Ações BR');

        await user.click(screen.getByRole('button', { name: /ocultar etfs/i }));

        // O denominador passa a ser só as ações: 300/400 e 100/400.
        expect(popover).not.toHaveTextContent('ETFs / Índices');
        expect(popover).toHaveTextContent('75.0%');
        expect(popover).toHaveTextContent('25.0%');
        // A base do percentual é dita na tela — o filtro nunca fica implícito.
        expect(popover).toHaveTextContent('% das ações individuais');

        // E o peso do que saiu continua legível no próprio botão.
        const toggle = screen.getByRole('button', { name: /mostrar etfs/i });
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(toggle).toHaveTextContent('60%');
    });

    it('não oferece o filtro quando a classe não tem os dois lados', async () => {
        const user = userEvent.setup();
        render(<SectorPopover kind="STOCK" items={[stock('ITUB4', 300, 'Bancos')]} />);

        await user.click(screen.getByRole('button', { name: /setores/i }));
        await screen.findByRole('dialog');

        expect(screen.queryByRole('button', { name: /ocultar etfs/i })).not.toBeInTheDocument();
    });
});

describe('SectorPopover — isolamento do cabeçalho do grupo', () => {
    const stock = (ticker: string, totalValue: number, sector?: string, type = 'STOCK'): Asset => ({
        ...fii(ticker, totalValue, sector),
        type,
    } as unknown as Asset);

    // O popover é um portal, mas o evento de React sobe pela árvore de COMPONENTES:
    // sem stopPropagation, usar o filtro contrai a classe inteira na lista.
    it('não deixa o clique escapar para o cabeçalho que contrai a classe', async () => {
        const user = userEvent.setup();
        const onHeaderClick = vi.fn();
        render(
            <div onClick={onHeaderClick}>
                <SectorPopover
                    kind="STOCK"
                    items={[stock('ITUB4', 400, 'Bancos'), stock('BOVA11', 600, 'Índice Amplo', 'ETF')]}
                />
            </div>,
        );

        await user.click(screen.getByRole('button', { name: /setores/i }));
        onHeaderClick.mockClear();

        await user.click(screen.getByRole('button', { name: /ocultar etfs/i }));
        expect(onHeaderClick).not.toHaveBeenCalled();
    });
});
