import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { usePriceFetch } from './usePriceFetch';
import { marketService } from '../services/market';
import type { AssetFormState } from '../utils/assetTransaction';

/**
 * Preço sugerido no lançamento: data de hoje usa a cotação ao vivo, data
 * passada o histórico, data futura nada. A resposta de um ticker/data que o
 * usuário já trocou é descartada, e o nome digitado pelo usuário não é
 * sobrescrito.
 */

vi.mock('../services/market', () => ({
  marketService: { getCurrentQuote: vi.fn(), getHistoricalPrice: vi.fn() },
}));

const getCurrentQuote = vi.mocked(marketService.getCurrentQuote);
const getHistoricalPrice = vi.mocked(marketService.getHistoricalPrice);

const TODAY = '2026-11-20';

const baseForm: AssetFormState = {
  ticker: 'PETR4', name: '', type: 'STOCK', quantity: '10', price: '', rate: '', date: TODAY,
};

const setup = (overrides: Partial<AssetFormState> = {}, isOpen = true) =>
  renderHook(({ open }: { open: boolean }) => {
    const [form, setForm] = useState<AssetFormState>({ ...baseForm, ...overrides });
    return { form, setForm, price: usePriceFetch({ isOpen: open, form, setForm }) };
  }, { initialProps: { open: isOpen } });

const flush = async (ms = 600) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  // Meio da tarde em Brasília: a data local é a mesma em qualquer fuso do CI.
  vi.setSystemTime(new Date('2026-11-20T15:00:00-03:00'));
  getCurrentQuote.mockReset();
  getHistoricalPrice.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('usePriceFetch — escolha da fonte pela data', () => {
  it('hoje: cotação ao vivo, preço em pt-BR e nome real preenchido', async () => {
    getCurrentQuote.mockResolvedValue({ price: 31.2, name: 'Petrobras PN' });
    const { result } = setup();

    expect(result.current.price.isFetchingPrice).toBe(true);
    await flush();

    expect(getCurrentQuote).toHaveBeenCalledWith('PETR4');
    expect(getHistoricalPrice).not.toHaveBeenCalled();
    expect(result.current.form.price).toBe('31,20');
    expect(result.current.form.name).toBe('Petrobras PN');
    expect(result.current.price).toMatchObject({
      isFetchingPrice: false, priceSource: 'historical', suggestedPrice: 31.2, isCurrentPrice: true, historicalDateFound: null,
    });
  });

  it('data passada: histórico; pregão anterior encontrado é avisado', async () => {
    getHistoricalPrice.mockResolvedValue({ price: 30, foundDate: '2026-11-14' });
    const { result } = setup({ date: '2026-11-15' });
    await flush();

    expect(getHistoricalPrice).toHaveBeenCalledWith('PETR4', '2026-11-15', 'STOCK');
    expect(result.current.price.historicalDateFound).toBe('2026-11-14');
    expect(result.current.price.isCurrentPrice).toBe(false);
    expect(result.current.form.price).toBe('30,00');
  });

  it('histórico da própria data não gera aviso de data diferente', async () => {
    getHistoricalPrice.mockResolvedValue({ price: 30, foundDate: '2026-11-13' });
    const { result } = setup({ date: '2026-11-13' });
    await flush();
    expect(result.current.price.historicalDateFound).toBeNull();
  });

  it('data futura não consulta nada e fica no manual', async () => {
    const { result } = setup({ date: '2026-12-01' });
    await flush();
    expect(getCurrentQuote).not.toHaveBeenCalled();
    expect(getHistoricalPrice).not.toHaveBeenCalled();
    expect(result.current.price.priceSource).toBe('manual');
    expect(result.current.price.isFetchingPrice).toBe(false);
  });

  it('cotação zerada ou ausente não vira preço sugerido', async () => {
    getCurrentQuote.mockResolvedValue({ price: 0 });
    const { result } = setup();
    await flush();
    expect(result.current.form.price).toBe('');
    expect(result.current.price.priceSource).toBe('manual');
    expect(result.current.price.suggestedPrice).toBeNull();
  });

  it('cripto sub-centavo mantém os algarismos significativos (SHIB não vira 0,00)', async () => {
    getCurrentQuote.mockResolvedValue({ price: 0.00001234, name: 'SHIB' });
    const { result } = setup({ ticker: 'SHIB', type: 'CRYPTO' });
    await flush();
    expect(result.current.form.price).toBe('0,00001234');
  });
});

describe('usePriceFetch — quando não buscar', () => {
  it.each([
    ['modal fechado', {}, false],
    ['caixa', { type: 'CASH' }, true],
    ['renda fixa', { type: 'FIXED_INCOME' }, true],
    ['ticker curto', { ticker: 'PE' }, true],
    ['sem data', { date: '' }, true],
  ] as const)('%s', async (_n, overrides, open) => {
    const { result } = setup(overrides, open);
    await flush();
    expect(getCurrentQuote).not.toHaveBeenCalled();
    expect(getHistoricalPrice).not.toHaveBeenCalled();
    expect(result.current.price.isFetchingPrice).toBe(false);
  });
});

describe('usePriceFetch — nome, cache e corrida', () => {
  it('não sobrescreve o nome que o usuário digitou', async () => {
    getCurrentQuote.mockResolvedValue({ price: 10, name: 'Petrobras PN' });
    const { result } = setup({ name: 'Minha Petro' });
    await flush();
    expect(result.current.form.name).toBe('Minha Petro');
  });

  it('troca o nome quando ele ainda é o próprio ticker', async () => {
    getCurrentQuote.mockResolvedValue({ price: 10, name: 'Petrobras PN' });
    const { result } = setup({ name: 'petr4' });
    await flush();
    expect(result.current.form.name).toBe('Petrobras PN');
  });

  it('voltar a um ticker/data já consultado usa o cache, sem nova ida ao servidor', async () => {
    getCurrentQuote.mockResolvedValue({ price: 10, name: 'Petrobras PN' });
    const { result } = setup();
    await flush();

    act(() => result.current.setForm((f) => ({ ...f, ticker: 'VALE3' })));
    await flush();
    act(() => result.current.setForm((f) => ({ ...f, ticker: 'PETR4', price: '' })));

    expect(getCurrentQuote).toHaveBeenCalledTimes(2);
    expect(result.current.form.price).toBe('10,00');
    expect(result.current.price.isFetchingPrice).toBe(false);
  });

  it('resposta de um ticker já trocado é descartada', async () => {
    let resolveOld: (v: unknown) => void = () => undefined;
    getCurrentQuote
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }))
      .mockResolvedValueOnce({ price: 60, name: 'Vale ON' });
    const { result } = setup();
    await flush();

    act(() => result.current.setForm((f) => ({ ...f, ticker: 'VALE3', name: '' })));
    await flush();
    await act(async () => { resolveOld({ price: 31, name: 'Petrobras PN' }); });

    expect(result.current.form.price).toBe('60,00');
    expect(result.current.form.name).toBe('Vale ON');
  });

  it('debounce: trocar o ticker antes de 600ms consulta só o último', async () => {
    getCurrentQuote.mockResolvedValue({ price: 5 });
    const { result } = setup();
    await flush(300);
    act(() => result.current.setForm((f) => ({ ...f, ticker: 'ITUB4' })));
    await flush();
    expect(getCurrentQuote).toHaveBeenCalledTimes(1);
    expect(getCurrentQuote).toHaveBeenCalledWith('ITUB4');
  });

  it('falha da cotação degrada para manual e encerra o carregamento', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getCurrentQuote.mockRejectedValue(new Error('offline'));
    const { result } = setup();
    await flush();
    expect(result.current.price.priceSource).toBe('manual');
    expect(result.current.price.isFetchingPrice).toBe(false);
  });

  it('setManual e reset limpam o estado de preço sugerido', async () => {
    getCurrentQuote.mockResolvedValue({ price: 10 });
    const { result } = setup();
    await flush();

    act(() => result.current.price.setManual());
    expect(result.current.price.priceSource).toBe('manual');
    expect(result.current.price.isCurrentPrice).toBe(false);
    expect(result.current.price.suggestedPrice).toBe(10);

    act(() => result.current.price.reset());
    expect(result.current.price).toMatchObject({ suggestedPrice: null, historicalDateFound: null, isFetchingPrice: false });
  });
});
