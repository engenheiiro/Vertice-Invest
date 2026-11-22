import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, type KeyboardEvent } from 'react';
import { useAssetSearch } from './useAssetSearch';
import { walletService } from '../services/wallet';
import type { AssetFormState } from '../utils/assetTransaction';

/**
 * Autocomplete de ticker: debounce de 300ms, mínimo de caracteres por classe,
 * descarte de resposta atrasada, título manual de Renda Fixa e a tradução do
 * resultado escolhido para o formulário (taxa pt-BR, vencimento ISO, modo).
 */

const addToast = vi.fn();
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../services/wallet', () => ({ walletService: { searchAsset: vi.fn() } }));

const searchAsset = vi.mocked(walletService.searchAsset);

const baseForm: AssetFormState = {
  ticker: '', name: '', type: 'STOCK', quantity: '10', price: '', rate: '', date: '2026-11-20',
};

const setup = (overrides: Partial<AssetFormState> = {}, transactionType: 'BUY' | 'SELL' = 'BUY') =>
  renderHook(() => {
    const [form, setForm] = useState<AssetFormState>({ ...baseForm, ...overrides });
    return { form, search: useAssetSearch({ form, transactionType, setForm }) };
  });

const flushDebounce = async (ms = 300) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

const key = (k: string) => {
  const preventDefault = vi.fn();
  return { event: { key: k, preventDefault } as unknown as KeyboardEvent<HTMLInputElement>, preventDefault };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  searchAsset.mockReset();
  addToast.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAssetSearch — disparo da busca', () => {
  it('espera 300ms e busca com a classe do formulário', async () => {
    searchAsset.mockResolvedValue([{ ticker: 'PETR4', name: 'Petrobras' }]);
    const { result } = setup();

    act(() => result.current.search.searchTicker('PET'));
    expect(result.current.search.isSearching).toBe(true);
    await flushDebounce(299);
    expect(searchAsset).not.toHaveBeenCalled();
    await flushDebounce(1);

    expect(searchAsset).toHaveBeenCalledWith('PET', 'STOCK');
    expect(result.current.search.showDropdown).toBe(true);
    expect(result.current.search.searchResults).toEqual([{ ticker: 'PETR4', name: 'Petrobras' }]);
    expect(result.current.search.isSearching).toBe(false);
  });

  it('digitação rápida dispara uma única busca, com o último valor', async () => {
    searchAsset.mockResolvedValue([]);
    const { result } = setup();

    act(() => result.current.search.searchTicker('PET'));
    await flushDebounce(100);
    act(() => result.current.search.searchTicker('PETR'));
    await flushDebounce(300);

    expect(searchAsset).toHaveBeenCalledTimes(1);
    expect(searchAsset).toHaveBeenCalledWith('PETR', 'STOCK');
  });

  it('ação exige 3 caracteres; abaixo disso limpa e fecha o dropdown', async () => {
    const { result } = setup();
    act(() => result.current.search.searchTicker('PE'));
    await flushDebounce();
    expect(searchAsset).not.toHaveBeenCalled();
    expect(result.current.search.isSearching).toBe(false);
    expect(result.current.search.showDropdown).toBe(false);
  });

  it('Renda Fixa busca com 2 caracteres', async () => {
    searchAsset.mockResolvedValue([{ ticker: 'TESOURO IPCA+ 2035' }]);
    const { result } = setup({ type: 'FIXED_INCOME' });
    act(() => result.current.search.searchTicker('TE'));
    await flushDebounce();
    expect(searchAsset).toHaveBeenCalledWith('TE', 'FIXED_INCOME');
  });

  it.each([
    ['venda (usa o select da carteira)', {}, 'SELL'],
    ['caixa (não tem catálogo)', { type: 'CASH' }, 'BUY'],
  ] as const)('não busca em %s', async (_n, overrides, tx) => {
    const { result } = setup(overrides, tx);
    act(() => result.current.search.searchTicker('PETR4'));
    await flushDebounce();
    expect(searchAsset).not.toHaveBeenCalled();
    expect(result.current.search.isSearching).toBe(false);
  });

  it('Renda Fixa sem resultado oferece criar o título manual', async () => {
    searchAsset.mockResolvedValue([]);
    const { result } = setup({ type: 'FIXED_INCOME' });
    act(() => result.current.search.searchTicker('CDB Banco X'));
    await flushDebounce();
    expect(result.current.search.searchResults).toEqual([
      { ticker: 'CDB Banco X', name: 'Criar: CDB Banco X', type: 'FIXED_INCOME', isManual: true },
    ]);
    expect(result.current.search.showDropdown).toBe(true);
  });

  it('ação sem resultado (ou resposta nula) fecha o dropdown', async () => {
    searchAsset.mockResolvedValue(null);
    const { result } = setup();
    act(() => result.current.search.searchTicker('XPTO9'));
    await flushDebounce();
    expect(result.current.search.searchResults).toEqual([]);
    expect(result.current.search.showDropdown).toBe(false);
  });

  it('falha de rede aparece em toast em vez de sumir em silêncio', async () => {
    searchAsset.mockRejectedValue(new Error('offline'));
    const { result } = setup();
    act(() => result.current.search.searchTicker('PETR4'));
    await flushDebounce();
    expect(addToast).toHaveBeenCalledWith('Não foi possível buscar o ativo. Verifique sua conexão.', 'error');
    expect(result.current.search.showDropdown).toBe(false);
    expect(result.current.search.isSearching).toBe(false);
  });

  it('resposta atrasada de uma busca antiga não repõe o dropdown', async () => {
    let resolveOld: (v: unknown) => void = () => undefined;
    searchAsset
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }))
      .mockResolvedValueOnce([{ ticker: 'PETR4' }]);
    const { result } = setup();

    act(() => result.current.search.searchTicker('PET'));
    await flushDebounce();
    act(() => result.current.search.searchTicker('PETR4'));
    await flushDebounce();
    await act(async () => { resolveOld([{ ticker: 'PETZ3' }]); });

    expect(result.current.search.searchResults).toEqual([{ ticker: 'PETR4' }]);
  });

  it('erro de busca já superada não gera toast', async () => {
    let rejectOld: (e: Error) => void = () => undefined;
    searchAsset
      .mockImplementationOnce(() => new Promise((_r, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce([{ ticker: 'VALE3' }]);
    const { result } = setup();

    act(() => result.current.search.searchTicker('VAL'));
    await flushDebounce();
    act(() => result.current.search.searchTicker('VALE3'));
    await flushDebounce();
    await act(async () => { rejectOld(new Error('timeout')); });

    expect(addToast).not.toHaveBeenCalled();
    expect(result.current.search.searchResults).toEqual([{ ticker: 'VALE3' }]);
  });
});

describe('useAssetSearch — selectResult', () => {
  it('título do Tesouro: taxa em pt-BR, vencimento ISO, modo pelo índice, quantidade 1', () => {
    const { result } = setup({ type: 'FIXED_INCOME', quantity: '7' });
    act(() => result.current.search.selectResult({
      ticker: 'TESOURO IPCA+ 2035', name: 'Tesouro IPCA+ 2035', type: 'FIXED_INCOME',
      rate: 6.5, index: 'ipca', maturityDate: '15/05/2035',
    }));
    expect(result.current.form).toMatchObject({
      ticker: 'TESOURO IPCA+ 2035',
      name: 'Tesouro IPCA+ 2035',
      type: 'FIXED_INCOME',
      rate: '6,5',
      quantity: '1',
      fixedIncomeIndex: 'IPCA',
      fixedIncomeMode: 'IPCA',
      maturityDate: '2035-05-15',
    });
  });

  it('taxa inteira ganha ",00"; vencimento fora do formato é ignorado', () => {
    const { result } = setup({ type: 'FIXED_INCOME', maturityDate: '2030-01-01' });
    act(() => result.current.search.selectResult({ ticker: 'LTN 2029', type: 'FIXED_INCOME', rate: 12, index: 'PRE', maturityDate: '2029' }));
    expect(result.current.form.rate).toBe('12,00');
    expect(result.current.form.maturityDate).toBe('2030-01-01');
    expect(result.current.form.fixedIncomeMode).toBe('PRE');
  });

  it('título manual não vaza o rótulo "Criar: X" para o nome e preserva o modo escolhido', () => {
    const { result } = setup({ type: 'FIXED_INCOME', fixedIncomeMode: 'SELIC', rate: '110' });
    act(() => result.current.search.selectResult({ ticker: 'CDB X', name: 'Criar: CDB X', type: 'FIXED_INCOME', isManual: true }));
    expect(result.current.form).toMatchObject({ ticker: 'CDB X', name: 'CDB X', rate: '110', fixedIncomeMode: 'SELIC' });
  });

  it('ação mantém a quantidade digitada e o tipo do formulário quando o resultado não traz tipo', () => {
    const { result } = setup({ quantity: '25' });
    act(() => result.current.search.selectResult({ name: 'ITUB4' }));
    expect(result.current.form).toMatchObject({ ticker: 'ITUB4', name: 'ITUB4', type: 'STOCK', quantity: '25' });
  });

  it('escolher cancela a busca pendente: o dropdown não reabre por cima', async () => {
    searchAsset.mockResolvedValue([{ ticker: 'BBAS3' }]);
    const { result } = setup();
    act(() => result.current.search.searchTicker('BBA'));
    act(() => result.current.search.selectResult({ ticker: 'BBAS3', name: 'Banco do Brasil' }));
    await flushDebounce();
    expect(searchAsset).not.toHaveBeenCalled();
    expect(result.current.search.showDropdown).toBe(false);
    expect(result.current.search.isSearching).toBe(false);
  });

  it('reset descarta a busca em voo', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    searchAsset.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { result } = setup();
    act(() => result.current.search.searchTicker('WEGE3'));
    await flushDebounce();
    act(() => result.current.search.reset());
    await act(async () => { resolve([{ ticker: 'WEGE3' }]); });
    expect(result.current.search.showDropdown).toBe(false);
    expect(result.current.search.searchResults).toEqual([]);
  });
});

describe('useAssetSearch — teclado e clique fora', () => {
  const withResults = async () => {
    searchAsset.mockResolvedValue([{ ticker: 'A' }, { ticker: 'B' }, { ticker: 'C', name: 'Cia C' }]);
    const hook = setup();
    act(() => hook.result.current.search.searchTicker('AAA'));
    await flushDebounce();
    return hook;
  };

  // Defeito corrigido: sem destaque, ArrowUp caía no PENÚLTIMO item ((-1 - 1 + n) % n).
  it('ArrowUp sem destaque vai ao último item; setas circulam e Enter escolhe o destacado', async () => {
    const { result } = await withResults();

    const up = key('ArrowUp');
    act(() => result.current.search.handleKeyDown(up.event));
    expect(up.preventDefault).toHaveBeenCalled();
    expect(result.current.search.activeIndex).toBe(2);

    act(() => result.current.search.handleKeyDown(key('ArrowDown').event));
    expect(result.current.search.activeIndex).toBe(0);
    act(() => result.current.search.handleKeyDown(key('ArrowUp').event));
    expect(result.current.search.activeIndex).toBe(2);

    const enter = key('Enter');
    act(() => result.current.search.handleKeyDown(enter.event));
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(result.current.form.ticker).toBe('C');
    expect(result.current.form.name).toBe('Cia C');
    expect(result.current.search.showDropdown).toBe(false);
  });

  it('Enter sem destaque não envia nada nem escolhe; Escape fecha', async () => {
    const { result } = await withResults();
    const enter = key('Enter');
    act(() => result.current.search.handleKeyDown(enter.event));
    expect(enter.preventDefault).not.toHaveBeenCalled();
    expect(result.current.form.ticker).toBe('');

    act(() => result.current.search.handleKeyDown(key('Escape').event));
    expect(result.current.search.showDropdown).toBe(false);
    expect(result.current.search.activeIndex).toBe(-1);
  });

  it('teclas são ignoradas com o dropdown fechado', () => {
    const { result } = setup();
    const down = key('ArrowDown');
    act(() => result.current.search.handleKeyDown(down.event));
    expect(down.preventDefault).not.toHaveBeenCalled();
    expect(result.current.search.activeIndex).toBe(-1);
  });

  it('clique fora do campo fecha o dropdown; clique dentro mantém', async () => {
    const { result } = await withResults();
    const container = document.createElement('div');
    const inside = document.createElement('input');
    container.appendChild(inside);
    document.body.appendChild(container);
    result.current.search.containerRef.current = container;

    act(() => { inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(result.current.search.showDropdown).toBe(true);

    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(result.current.search.showDropdown).toBe(false);
    container.remove();
  });
});
