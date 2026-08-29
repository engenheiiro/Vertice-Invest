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
 * Fração implícita de um título do Tesouro. DUAS casas, porque essa é a
 * granularidade real do Tesouro Direto: a compra mínima é 0,01 título e nada
 * abaixo disso é negociável.
 *
 * Existe separada de `formatQuantity` porque o número é DERIVADO (custo ÷ PU de
 * compra), não negociado: com 8 casas, um lote de R$ 87,86 aparecia como
 * "0,18349659 un", exibindo como precisão o resto de uma divisão — e sugerindo
 * uma quantidade que o extrato da corretora nunca vai confirmar.
 *
 * Abaixo de 0,01 a régua afrouxa em vez de arredondar: uma posição menor que a
 * granularidade oficial só aparece em cadastro legado ou custo errado, e "0 un"
 * esconderia justamente o caso que precisa ser visto.
 */
export function formatTreasuryUnits(
  value: number | null | undefined,
  options: FormatOptions = {},
): string {
  const units = toSafeNumber(value);
  return formatQuantity(value, { ...options, maxDecimals: Math.abs(units) < 0.01 ? 8 : 2 });
}

/** Confiança do Sharpe, derivada do tamanho da amostra (definida no servidor). */
export type SharpeConfidence = 'LOW' | 'MODERATE' | 'HIGH';

/**
 * Índice de Sharpe. Devolve `null` quando não há indicador (servidor manda
 * `null` em amostra insuficiente) — o chamador esconde o badge em vez de
 * inventar um número.
 *
 * Duas casas: em carteiras dominadas por caixa o Sharpe vive perto de zero, e
 * `toFixed(1)` transformava -0,0168 no literal `"-0.0"`, que parece defeito.
 * Valores dentro de ±0,005 são normalizados para 0 para nunca exibir `"-0,00"`.
 *
 * Amostra fraca ganha o prefixo `~`: cabe no badge sem quebrar o layout e é lido
 * universalmente como "aproximado". O detalhe fica no tooltip (`describeSharpe`).
 */
export function formatSharpe(
  value: number | null | undefined,
  options: { confidence?: SharpeConfidence | null } = {},
): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  const prefix = options.confidence === 'LOW' ? '~' : '';
  return `${prefix}${normalized.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Texto do tooltip do Sharpe. Existe porque o indicador sozinho num badge limpo
 * transmite uma precisão que a amostra raramente sustenta: com poucos pregões a
 * margem de erro chega a ser maior que o próprio valor, e quem lê precisa saber
 * disso antes de decidir qualquer coisa.
 */
export function describeSharpe(params: {
  standardError?: number | null;
  confidence?: SharpeConfidence | null;
  sample?: number | null;
} = {}): string {
  const parts = ['Índice de Sharpe (retorno ajustado ao risco)'];

  if (typeof params.sample === 'number' && params.sample > 0) {
    parts.push(`medido sobre ${params.sample} pregões`);
  }

  const base = `${parts.join(', ')}.`;
  const detail: string[] = [];

  if (typeof params.standardError === 'number' && Number.isFinite(params.standardError)) {
    detail.push(`Margem de erro ±${params.standardError.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}.`);
  }

  if (params.confidence === 'LOW') {
    detail.push('Amostra curta: trate como indicativo, não como medida.');
  } else if (params.confidence === 'MODERATE') {
    detail.push('Amostra ainda parcial (menos de 1 ano).');
  }

  return [base, ...detail].join(' ');
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
