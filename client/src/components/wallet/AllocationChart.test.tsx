/**
 * Testes do AllocationChart (donut "Distribuição" da Carteira).
 *
 * Cobre: estados vazios (sem ativos, só reserva, ideal não definida), legenda
 * Atual × Ideal com divergência em p.p., sub-linhas ramificadas, modo leitura
 * (link público sem alternador) e o editor da Carteira Ideal — validação da
 * soma 100%, das sub-metas e a gravação via `updateTargets`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AllocationChart } from './AllocationChart';
import { useWallet, DEFAULT_SUB_ALLOCATION } from '../../contexts/WalletContext';

const addToast = vi.fn();
const updateTargets = vi.fn();

vi.mock('../../contexts/WalletContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/WalletContext')>();
  return { ...actual, useWallet: vi.fn() };
});
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

type Wallet = ReturnType<typeof useWallet>;

const TARGET = { STOCK: 50, FII: 30, STOCK_US: 0, ETF: 0, CRYPTO: 0, FIXED_INCOME: 20, OURO: 0, CASH: 0 };

const asset = (ticker: string, type: string, totalValue: number, extra: Record<string, unknown> = {}) => ({
  id: ticker, ticker, type, totalValue, quantity: 1, averagePrice: totalValue, currentPrice: totalValue, ...extra,
});

function mockWallet(over: Partial<Record<string, unknown>> = {}) {
  const value = {
    assets: [],
    kpis: { totalEquity: 0 },
    targetAllocation: TARGET,
    targetReserve: 0,
    targetMonthlyDividendIncome: 0,
    targetSubAllocation: DEFAULT_SUB_ALLOCATION,
    updateTargets,
    isPrivacyMode: false,
    isReadOnly: false,
    ...over,
  };
  vi.mocked(useWallet).mockReturnValue(value as unknown as Wallet);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('estados vazios', () => {
  it('sem ativos e sem reserva mostra "Sem ativos ainda"', () => {
    mockWallet();
    render(<AllocationChart />);
    expect(screen.getByText('Sem ativos ainda')).toBeInTheDocument();
  });

  it('só com reserva mostra "Reserva 100% protegida" e leva à visão Ideal', () => {
    mockWallet({ assets: [asset('CDB', 'CASH', 5000)], kpis: { totalEquity: 5000 } });
    render(<AllocationChart />);
    expect(screen.getByText('Reserva 100% protegida')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ver alocação ideal/ }));
    expect(screen.getByText('Alocação-alvo do seu perfil')).toBeInTheDocument();
  });

  it('visão Ideal sem meta definida pede para configurar', () => {
    mockWallet({ targetAllocation: { ...TARGET, STOCK: 0, FII: 0, FIXED_INCOME: 0 } });
    render(<AllocationChart initialViewMode="IDEAL" />);
    expect(screen.getByText('Carteira ideal não definida')).toBeInTheDocument();
  });
});

describe('legenda com dados', () => {
  const assets = [asset('PETR4', 'STOCK', 6000), asset('HGLG11', 'FII', 4000), asset('RESERVA', 'CASH', 1000)];

  it('mostra participação real e divergência contra a meta em p.p.', async () => {
    mockWallet({ assets, kpis: { totalEquity: 11000 }, targetReserve: 3000 });
    const { container } = render(<AllocationChart />);

    expect(screen.getByRole('img', { name: /Ações BR 60%, FIIs 40%/ })).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    // Ações 60 × 50 e FIIs 40 × 30: as duas acima da meta.
    const acima = screen.getAllByText('+10.0 p.p.');
    expect(acima).toHaveLength(2);
    acima.forEach((el) => expect(el).toHaveClass('text-emerald-400'));
    // Reserva abaixo da meta em mais de R$ 100 → divergência negativa em reais.
    expect(screen.getByText('Reserva')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('alternar para Ideal mostra as metas, inclusive a reserva em reais', () => {
    mockWallet({ assets, kpis: { totalEquity: 11000 }, targetReserve: 3000 });
    render(<AllocationChart />);
    fireEvent.click(screen.getByRole('button', { name: 'Ideal' }));
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument();
    expect(screen.queryByText(/p\.p\./)).not.toBeInTheDocument();
  });

  it('expandir Ações BR sem sub-meta lista a sub-alocação real', () => {
    mockWallet({
      assets: [asset('PETR4', 'STOCK', 6000), asset('BOVA11', 'ETF', 2000)],
      kpis: { totalEquity: 8000 },
    });
    render(<AllocationChart />);
    fireEvent.click(screen.getByRole('button', { name: 'Expandir Ações BR' }));
    expect(screen.getByText('Ações')).toBeInTheDocument();
    expect(screen.getByText('ETFs')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recolher Ações BR' }));
    expect(screen.queryByText('75%')).not.toBeInTheDocument();
  });

  it('sub-linha mostra divergência quando há sub-meta', () => {
    mockWallet({
      assets: [asset('PETR4', 'STOCK', 6000), asset('BOVA11', 'ETF', 2000)],
      kpis: { totalEquity: 8000 },
      targetSubAllocation: { ...DEFAULT_SUB_ALLOCATION, STOCK: { STOCK: 50, ETF: 50 } },
    });
    render(<AllocationChart />);
    fireEvent.click(screen.getByRole('button', { name: 'Expandir Ações BR' }));
    expect(screen.getByText('+25.0 p.p.')).toBeInTheDocument();
    expect(screen.getByText('-25.0 p.p.')).toHaveClass('text-rose-400');
  });

  it('Renda Fixa expandida sem nada mostra "Sem sub-metas definidas."', () => {
    mockWallet({ assets: [asset('PETR4', 'STOCK', 6000)], kpis: { totalEquity: 6000 } });
    render(<AllocationChart initialViewMode="IDEAL" />);
    fireEvent.click(screen.getByRole('button', { name: 'Expandir Renda Fixa' }));
    expect(screen.getByText('Sem sub-metas definidas.')).toBeInTheDocument();
  });

  it('em leitura pública não há alternador nem engrenagem', () => {
    mockWallet({ assets, kpis: { totalEquity: 11000 }, isReadOnly: true });
    render(<AllocationChart initialViewMode="IDEAL" />);
    expect(screen.queryByRole('button', { name: 'Ideal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar carteira ideal' })).not.toBeInTheDocument();
    expect(screen.getByText('Carteira de Investimentos')).toBeInTheDocument();
  });
});

describe('editor da Carteira Ideal', () => {
  const openEditor = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Configurar carteira ideal' }));
    return screen.getByText('Configurar Carteira Ideal').closest('div.absolute') as HTMLElement;
  };

  it('salva metas que somam 100% e passa reserva/meta de proventos numéricas', () => {
    mockWallet({ targetReserve: 2000, targetMonthlyDividendIncome: 500 });
    render(<AllocationChart />);
    const editor = openEditor();
    expect(within(editor).getByText('Total %: 100.0%')).toHaveClass('text-emerald-500');

    const [reserve, dividend] = within(editor).getAllByRole('spinbutton');
    fireEvent.change(reserve, { target: { value: '4000' } });
    fireEvent.change(dividend, { target: { value: '800' } });
    fireEvent.click(within(editor).getByRole('button', { name: /Salvar/ }));

    expect(updateTargets).toHaveBeenCalledWith(TARGET, 4000, expect.objectContaining({ STOCK: { STOCK: 0, ETF: 0 } }), 800);
    expect(screen.queryByText('Configurar Carteira Ideal')).not.toBeInTheDocument();
    expect(screen.getByText('Alocação-alvo do seu perfil')).toBeInTheDocument();
  });

  it('recusa soma diferente de 100% com toast de erro', () => {
    mockWallet();
    render(<AllocationChart />);
    const editor = openEditor();
    // Linhas de % na ordem: Ações BR, FIIs, Exterior, Renda Fixa, Cripto (após reserva e proventos).
    const inputs = within(editor).getAllByRole('spinbutton');
    fireEvent.change(inputs[2], { target: { value: '150' } }); // clampa em 100
    expect(within(editor).getByText('Total %: 150.0%')).toHaveClass('text-red-500');
    fireEvent.click(within(editor).getByRole('button', { name: /Salvar/ }));
    expect(addToast).toHaveBeenCalledWith('A soma das alocações deve ser 100%. Atual: 150.0%', 'error');
    expect(updateTargets).not.toHaveBeenCalled();
  });

  it('recusa sub-metas que não somam 100%', () => {
    mockWallet();
    render(<AllocationChart />);
    const editor = openEditor();
    fireEvent.click(within(editor).getByRole('button', { name: 'Definir sub-metas de Ações BR' }));
    expect(within(editor).getByText(/Sub-total: 0% \(sem sub-metas\)/)).toBeInTheDocument();
    const subInputs = within(editor).getAllByRole('spinbutton');
    // Reserva, Proventos, Ações BR, depois as 2 sub-metas de Ações BR.
    fireEvent.change(subInputs[3], { target: { value: '60' } });
    expect(within(editor).getByText(/Sub-total: 60%/)).toHaveClass('text-red-500');
    fireEvent.click(within(editor).getByRole('button', { name: /Salvar/ }));
    expect(addToast).toHaveBeenCalledWith('As sub-metas de Ações BR devem somar 100%. Atual: 60.0%', 'error');

    fireEvent.change(subInputs[4], { target: { value: '40' } });
    fireEvent.click(within(editor).getByRole('button', { name: /Salvar/ }));
    expect(updateTargets).toHaveBeenCalledWith(TARGET, 0, expect.objectContaining({ STOCK: { STOCK: 60, ETF: 40 } }), 0);
  });

  it('reserva vazia ou negativa não altera o valor digitado', () => {
    mockWallet({ targetReserve: 2000 });
    render(<AllocationChart />);
    const editor = openEditor();
    const [reserve] = within(editor).getAllByRole('spinbutton');
    fireEvent.change(reserve, { target: { value: '' } });
    expect(reserve).toHaveValue(2000);
    fireEvent.click(within(editor).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByText('Configurar Carteira Ideal')).not.toBeInTheDocument();
  });

  it('autoOpenDividendGoal abre o editor e avisa o pai', () => {
    const onAutoOpenHandled = vi.fn();
    mockWallet();
    render(<AllocationChart autoOpenDividendGoal onAutoOpenHandled={onAutoOpenHandled} />);
    expect(screen.getByText('Configurar Carteira Ideal')).toBeInTheDocument();
    expect(onAutoOpenHandled).toHaveBeenCalledTimes(1);
  });
});
