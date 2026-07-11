import type { Asset, AssetType } from '../contexts/WalletContext';

/**
 * Modo de rendimento de um título de Renda Fixa (UI). Diz COMO a taxa digitada
 * deve ser interpretada — resolve a ambiguidade "10% é do CDI ou prefixado?":
 *  - 'CDI_PCT' → % do CDI (ex.: 110 = 110% do CDI); pós-fixado multiplicativo.
 *  - 'PRE'     → prefixado, taxa cheia a.a. (ex.: 12 = 12% ao ano).
 *  - 'IPCA'    → IPCA + spread a.a. (ex.: 6 = IPCA + 6%).
 *  - 'SELIC'   → Selic + spread a.a. (ex.: 0,10 = Selic + 0,10%).
 */
export type FixedIncomeMode = 'CDI_PCT' | 'PRE' | 'IPCA' | 'SELIC';

/** Índice do catálogo (SELIC/CDI/IPCA/PRE) → modo de rendimento da UI. */
export const fixedIncomeModeFromIndex = (index?: string): FixedIncomeMode => {
  switch ((index || '').toUpperCase()) {
    case 'IPCA': return 'IPCA';
    case 'SELIC': return 'SELIC';
    case 'PRE': return 'PRE';
    // Catálogo do Tesouro não traz CDI; %CDI só aparece em CDB/LCI manuais.
    case 'CDI': return 'CDI_PCT';
    default: return 'CDI_PCT';
  }
};

/**
 * Traduz o modo + taxa digitada nos campos que o backend entende. Pós-fixados
 * indexados (IPCA/Selic) viram índice + spread; prefixado vira PRE + taxa cheia;
 * % do CDI usa o caminho legado (`fixedIncomeRate` > 50 = %CDI) sem índice.
 */
export const buildFixedIncomeRateFields = (
  mode: FixedIncomeMode,
  rateValue: number,
): { fixedIncomeRate: number; fixedIncomeIndex?: 'SELIC' | 'CDI' | 'IPCA' | 'PRE'; fixedIncomeSpread?: number } => {
  switch (mode) {
    case 'IPCA': return { fixedIncomeRate: rateValue, fixedIncomeIndex: 'IPCA', fixedIncomeSpread: rateValue };
    case 'SELIC': return { fixedIncomeRate: rateValue, fixedIncomeIndex: 'SELIC', fixedIncomeSpread: rateValue };
    case 'PRE': return { fixedIncomeRate: rateValue, fixedIncomeIndex: 'PRE' };
    case 'CDI_PCT':
    default: return { fixedIncomeRate: rateValue };
  }
};

export interface AssetFormState {
  ticker: string;
  name: string;
  type: AssetType;
  quantity: string;
  price: string;
  rate: string;
  date: string;
  // Renda fixa pós-fixada/indexada: índice de referência (SELIC/CDI/IPCA/PRE).
  // Quando definido, `rate` representa o spread a.a. sobre o índice.
  fixedIncomeIndex?: string;
  // Modo de rendimento da Renda Fixa (UI). Governa a interpretação de `rate`
  // (% do CDI, prefixado, IPCA+, Selic+). Ver FixedIncomeMode.
  fixedIncomeMode?: FixedIncomeMode;
  // Exterior (STOCK_US): sub-tipo manual (Stocks/REIT/Dólar). Vazio = auto.
  usSubType?: string;
  // Moeda explícita do lançamento. Para a classe ETF (nacional R$ vs internacional US$)
  // o modal define isto; quando ausente, cai no default por tipo.
  currency?: 'BRL' | 'USD';
  // C1: Renda Fixa marcada como "Reserva separada" (sai da base de alocação).
  // Só aplicável a FIXED_INCOME; CASH é sempre reserva (definido no backend).
  isReserve?: boolean;
  // C2: vencimento do título de Renda Fixa (YYYY-MM-DD). No vencimento o backend
  // congela o rendimento e marca VENCIDO. Vazio = sem vencimento (perpétua).
  maturityDate?: string;
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
  fixedIncomeIndex?: string;
  fixedIncomeSpread?: number;
  usSubType?: string;
  isReserve?: boolean;
  maturityDate?: string;
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

/**
 * Gera um ticker interno único para um novo "cofrinho" de Reserva/Caixa a partir
 * do nome escolhido pelo usuário. O ticker é só uma chave estável (não é exibido —
 * a UI mostra o nome); por isso pode ser renomeado sem afetar o ticker.
 * Ex.: "Viagem Europa" → "RESERVA-VIAGEM-EUROPA" (sufixo -2, -3… em colisão).
 */
export const makeReserveTicker = (name: string, existingTickers: string[]): string => {
  const base = (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const root = base ? `RESERVA-${base}` : 'RESERVA';
  const taken = new Set(existingTickers.map((t) => t.toUpperCase()));
  if (!taken.has(root)) return root;
  let i = 2;
  while (taken.has(`${root}-${i}`)) i++;
  return `${root}-${i}`;
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
      // Saque sai do cofrinho selecionado (form.ticker), não mais de um 'RESERVA' fixo.
      const owned = assets.find((a) => a.ticker === form.ticker);
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
  // Renda Fixa: o "modo" (definido na UI ou inferido do índice do catálogo) diz
  // como interpretar a taxa digitada — % do CDI, prefixado, IPCA+ ou Selic+.
  const fiMode = form.fixedIncomeMode || fixedIncomeModeFromIndex(form.fixedIncomeIndex);
  const fiFields = form.type === 'FIXED_INCOME'
    ? buildFixedIncomeRateFields(fiMode, finalRate)
    : { fixedIncomeRate: finalRate };

  return {
    payload: {
      ticker: finalTicker,
      name: form.name || finalTicker,
      type: form.type,
      quantity: finalQty,
      price: finalPrice,
      averagePrice: finalPrice,
      currency: form.currency || (form.type === 'STOCK_US' ? 'USD' : 'BRL'),
      sector: 'General',
      date: form.date,
      ...fiFields,
      // Override de sub-tipo só faz sentido para Exterior; vazio = backend classifica.
      ...(form.type === 'STOCK_US' && form.usSubType ? { usSubType: form.usSubType } : {}),
      // C1: "Reserva separada" só é enviada para Renda Fixa (CASH é sempre reserva
      // no backend; demais classes são sempre investimento).
      ...(form.type === 'FIXED_INCOME' ? { isReserve: !!form.isReserve } : {}),
      // C2: vencimento só faz sentido para Renda Fixa e quando informado.
      ...(form.type === 'FIXED_INCOME' && form.maturityDate ? { maturityDate: form.maturityDate } : {}),
    },
  };
}
