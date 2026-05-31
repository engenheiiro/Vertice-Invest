import type { Asset, AssetType } from '../contexts/WalletContext';

export interface AssetFormState {
  ticker: string;
  name: string;
  type: AssetType;
  quantity: string;
  price: string;
  rate: string;
  date: string;
}

export interface TransactionPayload {
  ticker: string;
  name: string;
  type: AssetType;
  quantity: number;
  price: number;
  averagePrice: number;
  currency: 'BRL' | 'USD';
  sector: string;
  date: string;
  fixedIncomeRate: number;
}

export interface ValidationResult {
  error?: string;
  payload?: TransactionPayload;
}

/** Data local (fuso do usuário) no formato `YYYY-MM-DD`. */
export const getLocalDateString = (): string => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Converte string monetária pt-BR (`1.234,56`) em float. `NaN` se vazio/ inválido. */
export const parseCurrencyToFloat = (value: string): number => {
  if (!value) return NaN;
  const clean = value.replace(/\./g, '').replace(',', '.');
  return parseFloat(clean);
};

/**
 * Validação pura da transação (M3, extraída do `handleSubmit` do AddAssetModal).
 * Retorna `{ error }` se inválida ou `{ payload }` pronto para `addAsset()`.
 * Não realiza efeitos colaterais — toasts/recálculo ficam no componente.
 */
export function validateTransaction(
  form: AssetFormState,
  transactionType: 'BUY' | 'SELL',
  assets: Asset[]
): ValidationResult {
  const today = getLocalDateString();

  // Bloqueia transações futuras.
  if (form.date > today) {
    return { error: 'Não é permitido lançar transações futuras.' };
  }

  let finalQty = 0;
  let finalPrice = 0;

  if (form.type === 'CASH') {
    const rawAmount = parseCurrencyToFloat(form.price);
    if (isNaN(rawAmount) || rawAmount <= 0) {
      return { error: 'O valor deve ser válido.' };
    }
    finalQty = rawAmount;
    finalPrice = 1;

    if (transactionType === 'SELL') {
      const owned = assets.find((a) => a.ticker === 'RESERVA');
      if (!owned || owned.quantity < finalQty) {
        const disponivel = owned
          ? owned.quantity.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          : 'R$ 0,00';
        return { error: `Saldo insuficiente. Disponível: ${disponivel}` };
      }
      finalQty = -finalQty;
    }
  } else {
    finalQty = parseFloat(form.quantity.replace(',', '.'));
    finalPrice = parseCurrencyToFloat(form.price);

    if (isNaN(finalQty) || finalQty <= 0) {
      return { error: 'A quantidade deve ser um número válido maior que zero.' };
    }
    if (isNaN(finalPrice) || finalPrice < 0) {
      return { error: 'O preço deve ser um valor válido.' };
    }

    if (transactionType === 'SELL') {
      const owned = assets.find((a) => a.ticker === form.ticker);
      if (!owned || owned.quantity < finalQty) {
        return { error: `Saldo insuficiente. Você possui ${owned ? owned.quantity : 0} unid.` };
      }
      finalQty = -finalQty;
    }
  }

  const finalRate = form.rate ? parseFloat(form.rate.replace(',', '.')) : 0;
  const finalTicker = form.ticker.toUpperCase();

  return {
    payload: {
      ticker: finalTicker,
      name: form.name || finalTicker,
      type: form.type,
      quantity: finalQty,
      price: finalPrice,
      averagePrice: finalPrice,
      currency: form.type === 'STOCK_US' ? 'USD' : 'BRL',
      sector: 'General',
      date: form.date,
      fixedIncomeRate: finalRate,
    },
  };
}
