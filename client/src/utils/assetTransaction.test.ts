import { describe, it, expect } from 'vitest';
import {
  getLocalDateString,
  parseCurrencyToFloat,
  validateTransaction,
  type AssetFormState,
} from './assetTransaction';
import type { Asset } from '../contexts/WalletContext';

const today = getLocalDateString();

// Form base válido de COMPRA de ação (sobrescreva campos por teste).
const makeForm = (over: Partial<AssetFormState> = {}): AssetFormState => ({
  ticker: 'PETR4',
  name: '',
  type: 'STOCK',
  quantity: '100',
  price: '38,50',
  rate: '',
  date: today,
  ...over,
});

// Asset parcial suficiente para os checks de saldo (só lê ticker/quantity).
const ownedAsset = (ticker: string, quantity: number): Asset =>
  ({ ticker, quantity } as Asset);

describe('parseCurrencyToFloat', () => {
  it('converte formato pt-BR com milhar e decimal', () => {
    expect(parseCurrencyToFloat('1.234,56')).toBe(1234.56);
  });
  it('converte valor simples com vírgula decimal', () => {
    expect(parseCurrencyToFloat('38,50')).toBe(38.5);
  });
  it('retorna NaN para string vazia', () => {
    expect(parseCurrencyToFloat('')).toBeNaN();
  });
});

describe('getLocalDateString', () => {
  it('retorna data no formato YYYY-MM-DD', () => {
    expect(getLocalDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('validateTransaction — bloqueios', () => {
  it('rejeita transação com data futura', () => {
    const { error, payload } = validateTransaction(makeForm({ date: '2999-01-01' }), 'BUY', []);
    expect(error).toMatch(/futuras/i);
    expect(payload).toBeUndefined();
  });

  it('rejeita quantidade inválida (zero)', () => {
    const { error } = validateTransaction(makeForm({ quantity: '0' }), 'BUY', []);
    expect(error).toMatch(/quantidade/i);
  });

  it('rejeita preço negativo', () => {
    const { error } = validateTransaction(makeForm({ price: '-5' }), 'BUY', []);
    expect(error).toMatch(/preço/i);
  });

  it('rejeita venda acima da posição (saldo insuficiente)', () => {
    const { error } = validateTransaction(
      makeForm({ quantity: '200' }),
      'SELL',
      [ownedAsset('PETR4', 100)]
    );
    expect(error).toMatch(/insuficiente/i);
  });

  it('rejeita saque CASH acima do saldo da RESERVA', () => {
    const form = makeForm({ type: 'CASH', ticker: 'RESERVA', price: '5.000,00', quantity: '' });
    const { error } = validateTransaction(form, 'SELL', [ownedAsset('RESERVA', 1000)]);
    expect(error).toMatch(/insuficiente/i);
  });
});

describe('validateTransaction — payloads válidos', () => {
  it('COMPRA de STOCK gera payload com quantidade positiva e BRL', () => {
    const { error, payload } = validateTransaction(makeForm(), 'BUY', []);
    expect(error).toBeUndefined();
    expect(payload).toMatchObject({
      ticker: 'PETR4',
      quantity: 100,
      price: 38.5,
      averagePrice: 38.5,
      currency: 'BRL',
      type: 'STOCK',
    });
  });

  it('STOCK_US usa moeda USD', () => {
    const { payload } = validateTransaction(makeForm({ type: 'STOCK_US', ticker: 'AAPL' }), 'BUY', []);
    expect(payload?.currency).toBe('USD');
  });

  it('VENDA gera quantidade negativa', () => {
    const { payload } = validateTransaction(
      makeForm({ quantity: '50' }),
      'SELL',
      [ownedAsset('PETR4', 100)]
    );
    expect(payload?.quantity).toBe(-50);
  });

  it('CASH (aporte) vira quantity=valor e price=1', () => {
    const form = makeForm({ type: 'CASH', ticker: 'RESERVA', price: '1.500,00', quantity: '' });
    const { payload } = validateTransaction(form, 'BUY', []);
    expect(payload?.quantity).toBe(1500);
    expect(payload?.price).toBe(1);
  });

  it('FIXED_INCOME converte a taxa e usa o nome como fallback do ticker', () => {
    const form = makeForm({ type: 'FIXED_INCOME', ticker: 'CDB XP', name: '', rate: '110,5', quantity: '1', price: '1.000,00' });
    const { payload } = validateTransaction(form, 'BUY', []);
    expect(payload?.fixedIncomeRate).toBe(110.5);
    expect(payload?.name).toBe('CDB XP'); // name vazio → usa ticker (uppercased)
    expect(payload?.ticker).toBe('CDB XP');
  });
});
