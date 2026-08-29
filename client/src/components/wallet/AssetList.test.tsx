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

describe('AssetList — ordem dentro da classe', () => {
    it('ordena por valor decrescente, com o ticker como desempate', () => {
        // Sem ordenação, a lista saía na ordem de CRIAÇÃO da posição: a mesma
        // carteira aparecia diferente conforme tivesse sido cadastrada à mão ou
        // importada do extrato da B3.
        vi.mocked(useWallet).mockReturnValue({
            assets: [
                asset({ id: 'a', ticker: 'PETR4', totalValue: 30, totalCost: 30 }),
                asset({ id: 'b', ticker: 'VALE3', totalValue: 50, totalCost: 50 }),
                asset({ id: 'c', ticker: 'BOVA11', type: 'ETF', allocationClass: 'STOCK', totalValue: 30, totalCost: 30 }),
            ],
            removeAsset: vi.fn(),
            kpis: { totalEquity: 110 },
            targetAllocation: {},
            isPrivacyMode: false,
        } as any);

        render(<AssetList />);

        const ordem = screen.getAllByText(/^(PETR4|VALE3|BOVA11)$/).map(el => el.textContent);
        expect(ordem.slice(0, 3)).toEqual(['VALE3', 'BOVA11', 'PETR4']);
    });
});

describe('AssetList — preço unitário', () => {
    /** Células da linha do desktop que contém aquele ativo. */
    const cellsOf = (titulo: string) => {
        const linha = Array.from(document.querySelectorAll('tbody tr'))
            .find(tr => tr.textContent?.includes(titulo));
        return Array.from(linha?.querySelectorAll('td') ?? []).map(td => td.textContent?.trim());
    };

    it('omite preço médio e preço atual em renda fixa e caixa', () => {
        // As colunas são custo÷quantidade e saldo÷quantidade, e em RF a quantidade
        // não segue convenção: cadastro manual grava 1 (o "preço" vira o total),
        // extrato da B3 traz a fração real (o "preço" vira o PU do título). O
        // mesmo título mostrava números diferentes na mesma coluna.
        vi.mocked(useWallet).mockReturnValue({
            assets: [
                asset({ id: 'rf', ticker: 'TESOURO IPCA+ 2032', type: 'FIXED_INCOME', quantity: 1, averagePrice: 735.92, currentPrice: 745.97, totalValue: 745.97, totalCost: 735.92 }),
                asset({ id: 'cash', ticker: 'RESERVA', type: 'CASH', name: 'Reserva de Emergência', isReserve: true, quantity: 16800, averagePrice: 1, currentPrice: 1, totalValue: 16800, totalCost: 16800 }),
                asset({ id: 'stock', ticker: 'PETR4', quantity: 10, averagePrice: 30, currentPrice: 33, totalValue: 330, totalCost: 300 }),
            ],
            removeAsset: vi.fn(),
            kpis: { totalEquity: 17875.97 },
            targetAllocation: {},
            isPrivacyMode: false,
        } as any);

        render(<AssetList />);

        expect(cellsOf('TESOURO IPCA+ 2032').slice(1, 3)).toEqual(['—', '—']);
        expect(cellsOf('Reserva de Emergência').slice(1, 3)).toEqual(['—', '—']);

        // Ativo com preço unitário de verdade continua mostrando os dois.
        const acao = cellsOf('PETR4');
        expect(acao[1]).toMatch(/30,00/);
        expect(acao[2]).toMatch(/33,00/);
    });

    it('mostra o PU OFICIAL quando o título público está marcado a mercado', () => {
        // O PU não depende da convenção de cadastro: a mesma posição lançada como
        // "1 × R$ 735,92" (manual) ou "0,25 × R$ 2.943,69" (extrato da B3) exibe
        // os mesmos R$ 2.943,68 → R$ 2.984,46, batendo com o Tesouro Direto.
        vi.mocked(useWallet).mockReturnValue({
            assets: [
                asset({
                    id: 'rf', ticker: 'TESOURO IPCA+ 2032', type: 'FIXED_INCOME',
                    quantity: 1, averagePrice: 735.92, currentPrice: 746.12,
                    totalValue: 746.12, totalCost: 735.92,
                    pricingSource: 'MTM', accruedValue: 743.56,
                    // A fração chega do servidor como custo ÷ PU, com 8 casas — é
                    // a tela que a corta na granularidade do Tesouro (0,01 título).
                    treasuryUnitPrice: 2984.46, treasuryAverageUnitPrice: 2943.68, treasuryUnits: 0.25013766,
                }),
            ],
            removeAsset: vi.fn(),
            kpis: { totalEquity: 746.12 },
            targetAllocation: {},
            isPrivacyMode: false,
        } as any);

        render(<AssetList />);

        const celulas = cellsOf('TESOURO IPCA+ 2032');
        expect(celulas[1]).toMatch(/2\.943,68/);
        expect(celulas[2]).toMatch(/2\.984,46/);
        // A fração acompanha o PU — sem ela, R$ 2.984 ao lado de R$ 746 não fecha.
        expect(screen.getAllByText(/0,25 un/).length).toBeGreaterThan(0);
    });

    it('troca a contagem de unidades pelo valor investido em renda fixa', () => {
        // "16.800 un" numa reserva é tão vazio quanto o preço unitário.
        vi.mocked(useWallet).mockReturnValue({
            assets: [
                asset({ id: 'rf', ticker: 'CDB BANCO X', type: 'FIXED_INCOME', quantity: 1, averagePrice: 284.64, currentPrice: 286.26, totalValue: 286.26, totalCost: 284.64 }),
            ],
            removeAsset: vi.fn(),
            kpis: { totalEquity: 286.26 },
            targetAllocation: {},
            isPrivacyMode: false,
        } as any);

        render(<AssetList />);

        expect(screen.getAllByText(/investido/).length).toBeGreaterThan(0);
        expect(screen.queryByText(/1 un/)).not.toBeInTheDocument();
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
