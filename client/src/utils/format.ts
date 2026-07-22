/**
 * Formatação central de números para a UI (C1).
 *
 * Antes, ~30 componentes reimplementavam `Intl.NumberFormat('pt-BR', ...)` e a
 * máscara de privacidade (`••••••`) cada um à sua maneira — divergindo em
 * arredondamento, símbolo de moeda e tratamento de `null/NaN`. Este módulo é a
 * fonte única: passe `{ privacy }` (geralmente `isPrivacyMode` do WalletContext)
 * para mascarar valores sensíveis.
 *
 * Convenção de moeda do projeto: B3 → `R$`; Cripto / ativos US → `US$`.
 */

export type Currency = 'BRL' | 'USD';

export interface FormatOptions {
  /** Mascara o valor (modo privacidade). */
  privacy?: boolean;
}

/** Máscara padrão para valores monetários ocultos. */
export const PRIVACY_MASK = '••••••';
/** Máscara curta (percentuais/quantidades). */
export const PRIVACY_MASK_SHORT = '•••';

const toSafeNumber = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Moeda formatada em pt-BR. `formatCurrency(4253)` → `"R$ 4.253,00"`;
 * `formatCurrency(28, 'USD')` → `"US$ 28,00"`.
 */
export function formatCurrency(
  value: number | null | undefined,
  currency: Currency = 'BRL',
  options: FormatOptions = {},
): string {
  if (options.privacy) return PRIVACY_MASK;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(toSafeNumber(value));
}

/**
 * Percentual em pt-BR. `formatPercent(6.333)` → `"6,33%"`.
 * `sign: true` prefixa `+` em valores positivos (`"+6,33%"`).
 */
export function formatPercent(
  value: number | null | undefined,
  options: FormatOptions & { decimals?: number; sign?: boolean } = {},
): string {
  if (options.privacy) return PRIVACY_MASK_SHORT;
  const v = toSafeNumber(value);
  const decimals = options.decimals ?? 2;
  const prefix = options.sign && v > 0 ? '+' : '';
  return `${prefix}${v.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

/**
 * Moeda compacta para eixos/resumos: `formatCompact(1234567)` → `"R$ 1,2 mi"`.
 * Passe `currency: null` para suprimir o símbolo (`"1,2 mi"`).
 */
export function formatCompact(
  value: number | null | undefined,
  currency: Currency | null = 'BRL',
  options: FormatOptions = {},
): string {
  if (options.privacy) return PRIVACY_MASK;
  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
    ...(currency ? { style: 'currency', currency } : {}),
  }).format(toSafeNumber(value));
}

/**
 * Quantidade de unidades/cotas. Cripto pode ter até 8 casas (1 satoshi) — sem
 * forçar casas decimais e cortando zeros à direita: `formatQuantity(0.0000028)`
 * → `"0,0000028"`; `formatQuantity(100)` → `"100"`.
 */
export function formatQuantity(
  value: number | null | undefined,
  options: FormatOptions & { maxDecimals?: number } = {},
): string {
  if (options.privacy) return PRIVACY_MASK_SHORT;
  return toSafeNumber(value).toLocaleString('pt-BR', {
    maximumFractionDigits: options.maxDecimals ?? 8,
  });
}

/**
 * Formata datas financeiras que representam um DIA, sem horário. Usa UTC de
 * propósito para compatibilidade com registros legados gravados à meia-noite Z:
 * `2026-07-21T00:00:00Z` deve continuar aparecendo como 21/07 no Brasil.
 */
export function formatCalendarDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}
