import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AssetSection } from './AssetSection';
import type { Asset } from '../../../contexts/WalletContext';
import type { AssetFormState } from '../../../utils/assetTransaction';
import { NEW_RESERVE, type AssetSearch } from './types';

const form = (over: Partial<AssetFormState> = {}): AssetFormState => ({
    ticker: '', name: '', type: 'STOCK', quantity: '', price: '', rate: '', date: '2026-11-20', ...over,
});

const search = (over: Partial<Record<string, unknown>> = {}) => ({
    searchResults: [],
    showDropdown: false,
    isSearching: false,
    activeIndex: -1,
    containerRef: React.createRef<HTMLDivElement>(),
    setShowDropdown: vi.fn(),
    setActiveIndex: vi.fn(),
    selectResult: vi.fn(),
    handleKeyDown: vi.fn(),
    ...over,
}) as unknown as AssetSearch;

const asset = (ticker: string, type: Asset['type'], quantity: number, name?: string) =>
    ({ id: ticker, ticker, type, quantity, name }) as Asset;

function setup(over: Partial<React.ComponentProps<typeof AssetSection>> = {}) {
    const props: React.ComponentProps<typeof AssetSection> = {
        form: form(),
        setForm: vi.fn(),
        transactionType: 'BUY',
        assets: [],
        reserves: [],
        cashSelection: '',
        setCashSelection: vi.fn(),
        search: search(),
        etfMarket: 'BR',
        onSelectEtfMarket: vi.fn(),
        onTickerChange: vi.fn(),
        onSellAssetSelect: vi.fn(),
        ...over,
    };
    return { props, ...render(<AssetSection {...props} />) };
}

describe('AssetSection', () => {
    it('compra: busca com resultados navegáveis e sem violação de acessibilidade', async () => {
        const s = search({
            showDropdown: true,
            activeIndex: 0,
            searchResults: [
                {
                    ticker: 'TESOURO IPCA+ 2035', name: 'Tesouro IPCA+', type: 'FIXED_INCOME',
                    isTreasury: true, rate: 6.3, index: 'IPCA', maturityDate: '15/05/2035',
                },
                { ticker: 'CDB X', name: 'Criar: CDB X', type: 'FIXED_INCOME', isManual: true, rate: 110 },
            ],
        });
        const { container } = setup({ form: form({ type: 'FIXED_INCOME' }), search: s });

        const box = screen.getByRole('combobox', { name: 'Nome do Título / Produto' });
        expect(box).toHaveAttribute('aria-activedescendant', 'asset-option-0');
        expect(screen.getByText('TESOURO')).toBeInTheDocument();
        expect(screen.getByText('110% CDI')).toBeInTheDocument();
        expect(screen.getByText('Venc. 15/05/2035')).toBeInTheDocument();

        fireEvent.mouseDown(screen.getAllByRole('option')[1]);
        expect(s.selectResult).toHaveBeenCalledWith(expect.objectContaining({ ticker: 'CDB X' }));
        expect(await axe(container)).toHaveNoViolations();
    });

    it('ETF americano mostra USD e troca o mercado pelo botão', async () => {
        const { props, container } = setup({ form: form({ type: 'ETF' }), etfMarket: 'US' });
        expect(screen.getByText('USD')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Ex: VOO, IVV, QQQ, VT')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Brasil (R$)' }));
        expect(props.onSelectEtfMarket).toHaveBeenCalledWith('BR');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('venda lista só posições da classe com saldo e avisa quando não há', () => {
        setup({
            transactionType: 'SELL',
            assets: [asset('PETR4', 'STOCK', 10), asset('VALE3', 'STOCK', 0), asset('MXRF11', 'FII', 3)],
        });
        const options = screen.getAllByRole('option').map((o) => o.textContent);
        expect(options).toEqual(['Selecione um ativo...', 'PETR4 - 10 unid.']);
    });

    it('cofrinho: sem reservas na compra pede nome e taxa; no saque, avisa que não há o que sacar', () => {
        setup({ form: form({ type: 'CASH' }) });
        expect(screen.getByLabelText('Nome do Cofrinho')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '➕ Criar novo cofrinho' })).toBeInTheDocument();
    });

    it('cofrinho existente na compra não pede nome; trocar o seletor avisa o pai', () => {
        const { props } = setup({
            form: form({ type: 'CASH' }),
            reserves: [asset('RES-1', 'CASH', 1, 'Viagem')],
            cashSelection: 'RES-1',
        });
        expect(screen.queryByLabelText('Nome do Cofrinho')).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: NEW_RESERVE } });
        expect(props.setCashSelection).toHaveBeenCalledWith(NEW_RESERVE);
    });

    it('saque sem reservas', () => {
        setup({ form: form({ type: 'CASH' }), transactionType: 'SELL' });
        expect(screen.getByText('Você ainda não possui reservas para sacar.')).toBeInTheDocument();
    });

    it('Exterior: sub-tipo vazio volta a ser automático (undefined)', () => {
        // O updater lê o evento na hora: aplica dentro do próprio setForm, como o React faria.
        const applied: AssetFormState[] = [];
        const setForm = vi.fn((u: React.SetStateAction<AssetFormState>) => {
            if (typeof u === 'function') applied.push(u(form({ usSubType: 'REIT' })));
        });
        setup({ form: form({ type: 'STOCK_US', usSubType: 'REIT' }), setForm });
        fireEvent.change(screen.getByLabelText('Tipo (Exterior)'), { target: { value: '' } });
        expect(applied).toHaveLength(1);
        expect(applied[0].usSubType).toBeUndefined();
    });
});
