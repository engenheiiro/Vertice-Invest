import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWallet } from '../../contexts/WalletContext';
import { AssetList } from './AssetList';

vi.mock('../../contexts/WalletContext', () => ({ useWallet: vi.fn() }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('./AssetTransactionsModal', () => ({ AssetTransactionsModal: () => null }));
vi.mock('./RenameReserveModal', () => ({ RenameReserveModal: () => null }));
vi.mock('../common/AssetLogo', () => ({ default: () => null }));
vi.mock('../common/AssetTags', () => ({ default: () => null }));

const asset = (overrides: Record<string, unknown>) => ({
    id: 'asset',
    ticker: 'ASSET',
    type: 'STOCK',
    quantity: 1,
    averagePrice: 1,
    currentPrice: 1,
    totalValue: 0,
    totalCost: 0,
    profit: 0,
    profitPercent: 0,
    currency: 'BRL',
    ...overrides,
});

const setMobileViewport = (isMobile: boolean) => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
        matches: query === '(max-width: 767px)' ? isMobile : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
};

beforeEach(() => setMobileViewport(false));

describe('AssetList — estado inicial responsivo', () => {
    beforeEach(() => {
        vi.mocked(useWallet).mockReturnValue({
            assets: [asset({ id: 'stock', ticker: 'PETR4', totalValue: 100, totalCost: 80 })],
            removeAsset: vi.fn(),
            kpis: { totalEquity: 100 },
            targetAllocation: {},
            isPrivacyMode: false,
        } as any);
    });

    it('inicia todas as classes contraídas no mobile', () => {
        setMobileViewport(true);
        render(<AssetList />);

        expect(screen.getByTitle('Expandir todas as classes')).toHaveAttribute('aria-expanded', 'false');
    });

    it('mantém as classes expandidas por padrão fora do mobile', () => {
        render(<AssetList />);

        expect(screen.getByTitle('Contrair todas as classes')).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('AssetList — subdivisão de Ações Brasil', () => {
    beforeEach(() => {
        vi.mocked(useWallet).mockReturnValue({
            assets: [
                asset({ id: 'stock', ticker: 'PETR4', totalValue: 4, totalCost: 4 }),
                asset({ id: 'etf', ticker: 'BOVA11', type: 'ETF', allocationClass: 'STOCK', totalValue: 28, totalCost: 28 }),
                asset({ id: 'fii', ticker: 'HGLG11', type: 'FII', totalValue: 68, totalCost: 68 }),
            ],
            removeAsset: vi.fn(),
            kpis: { totalEquity: 100 },
            targetAllocation: {},
            isPrivacyMode: false,
        } as any);
    });

    it('calcula Ações e ETFs dentro da classe e mantém a soma exibida em 100%', () => {
        render(<AssetList />);

        // A classe vale 32: 4/32 e 28/32. O complemento evita soma 101% no arredondamento.
        expect(screen.getAllByText('Ações 13% · ETFs 87%')).toHaveLength(2);
        expect(screen.queryByText('Ações 4% · ETFs 28%')).not.toBeInTheDocument();
    });
});

describe('AssetList — atalho de setores', () => {
    const mockWallet = (assets: unknown[]) => vi.mocked(useWallet).mockReturnValue({
        assets,
        removeAsset: vi.fn(),
        kpis: { totalEquity: 100 },
        targetAllocation: {},
        isPrivacyMode: false,
    } as any);

    it('mostra o chip nos grupos de Ações e FIIs (desktop + mobile)', () => {
        mockWallet([
            asset({ id: 'stock', ticker: 'PETR4', sector: 'Petróleo, Gás e Biocombustíveis', totalValue: 50, totalCost: 50 }),
            asset({ id: 'fii-1', ticker: 'HGLG11', type: 'FII', sector: 'Logística', totalValue: 30, totalCost: 30 }),
            asset({ id: 'fii-2', ticker: 'VISC11', type: 'FII', sector: 'Shoppings', totalValue: 20, totalCost: 20 }),
        ]);

        render(<AssetList />);

        // Duas classes × (cabeçalho da tabela no desktop + card empilhado no mobile).
        expect(screen.getAllByRole('button', { name: /setores/i })).toHaveLength(4);
    });

    it('não oferece o chip em classes sem setor (Renda Fixa / Reserva)', () => {
        mockWallet([
            asset({ id: 'cash', ticker: 'CAIXA', type: 'CASH', isReserve: true, totalValue: 40, totalCost: 40 }),
            asset({ id: 'rf', ticker: 'CDB', type: 'FIXED_INCOME', totalValue: 60, totalCost: 60 }),
        ]);

        render(<AssetList />);

        expect(screen.queryByRole('button', { name: /setores/i })).not.toBeInTheDocument();
    });
});

describe('AssetList — subdivisão de Exterior', () => {
    it('inclui ETFs do Exterior e mantém todos os subtipos somando 100%', () => {
        vi.mocked(useWallet).mockReturnValue({
            assets: [
                asset({ id: 'stock-us', ticker: 'AAPL', type: 'STOCK_US', currency: 'USD', usSubType: 'STOCK', totalValue: 10, totalCost: 10 }),
                asset({ id: 'reit', ticker: 'O', type: 'STOCK_US', currency: 'USD', usSubType: 'REIT', totalValue: 10, totalCost: 10 }),
                asset({ id: 'etf-us', ticker: 'VOO', type: 'STOCK_US', currency: 'USD', usSubType: 'ETF', totalValue: 30, totalCost: 30 }),
                asset({ id: 'etf-br', ticker: 'IVVB11', type: 'ETF', allocationClass: 'STOCK_US', totalValue: 40, totalCost: 40 }),
                asset({ id: 'dollar', ticker: 'USD', type: 'STOCK_US', currency: 'USD', usSubType: 'DOLLAR', totalValue: 10, totalCost: 10 }),
            ],
            removeAsset: vi.fn(),
            kpis: { totalEquity: 100 },
            targetAllocation: {},
            isPrivacyMode: false,
        } as any);

        render(<AssetList />);

        expect(screen.getAllByText('Stocks 10% · REITs 10% · ETFs 70% · Dólar 10%')).toHaveLength(2);
    });
});
