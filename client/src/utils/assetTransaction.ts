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
 * Preço unitário em texto pt-BR para o campo do formulário (sem símbolo).
 * Espelha `safeUnitPrice()` do servidor: de 1 para cima, 2 casas; abaixo de 1,
 * até 8 algarismos significativos. Com 2 casas fixas o SHIB (~0,00001) virava
 * "0,00" e o DOGE 0,123 virava "0,12" — o preço pré-preenchido gravava errado.
 * Sem separador de milhar abaixo de 1 (não há milhar ali) e nunca menos de 2
 * casas, para "0,5" continuar aparecendo como "0,50".
 */
export const formatUnitPriceInput = (price: number): string => {
  const twoDecimals = price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!Number.isFinite(price) || price === 0 || Math.abs(price) >= 1) return twoDecimals;
  const precise = price.toLocaleString('pt-BR', { maximumSignificantDigits: 8, useGrouping: false });
  const decimals = precise.split(',')[1]?.length ?? 0;
  return decimals < 2 ? twoDecimals : precise;
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
    // Preço zero não é lançamento válido: na Renda Fixa o campo é o valor
    // investido e nas demais o preço unitário — custo zero distorce preço médio
    // e rentabilidade. (CASH já barra `<= 0` no ramo acima.)
    if (isNaN(finalPrice) || finalPrice <= 0) {
      return { error: 'O preço deve ser um valor válido maior que zero.' };
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
