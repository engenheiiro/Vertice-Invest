/**
 * O que a tela da Calculadora mostra a partir dos números — textos, linhas de
 * tabela, cenários salvos e o estado do comparativo. Sem React, testável.
 */
import {
  brl, brl0, pct, formatPeriod, irRate, pickPrefixadoRate, CUSTODY, FUNDO_DI_ADMIN, LCI_PCT,
  type InstrumentResult, type MacroBond,
} from './calculatorMath';

export type CalcMode = 'simular' | 'meta';

export interface Scenario {
  /** Aba de origem. Cada lista só mostra os cenários da própria aba. */
  mode: CalcMode;
  initial: number;
  /** Aporte — escolhido no modo simular, calculado no modo meta. */
  monthly: number;
  months: number;
  /** Só no modo meta: o patrimônio líquido perseguido. */
  goal?: number;
  /** Instrumentos no gráfico e no comparativo lado a lado, na ordem em que entraram. */
  compare?: string[];
  /** Ticker da ação e do FII comparados — sem eles, um id de ativo em `compare` não resolve. */
  stock?: string | null;
  fii?: string | null;
  /** Nomes dos instrumentos comparados, para a lista mostrar o que vai ser restaurado. */
  compareLabels?: string;
  summary: string;
}

/**
 * Cenários gravados antes da separação por aba não têm `mode` — são de "simular";
 * os gravados antes de o comparativo ser salvo não têm `compare`, e nesse caso a
 * seleção atual da tela é preservada ao carregar.
 */
export const normalizeScenario = (s: Scenario): Scenario => ({
  ...s,
  mode: s.mode === 'meta' ? 'meta' : 'simular',
  compare: Array.isArray(s.compare) ? s.compare : [],
});

export const scenarioTitle = (s: Scenario) =>
  s.mode === 'meta'
    ? `Meta ${brl0(s.goal ?? 0)} · ${formatPeriod(s.months)}`
    : `${formatPeriod(s.months)} · ${brl0(s.monthly)}/mês · ${brl0(s.initial)}`;

export interface SelectedSeries { result: InstrumentResult; color: string }

interface ScenarioInput {
  mode: CalcMode;
  initial: number;
  monthly: number;
  months: number;
  goal: number;
  selected: SelectedSeries[];
  stock: string | null;
  fii: string | null;
  best: InstrumentResult;
}

export const buildScenario = (i: ScenarioInput): Scenario => ({
  mode: i.mode,
  initial: i.initial,
  monthly: i.monthly,
  months: i.months,
  ...(i.mode === 'meta' ? { goal: i.goal } : {}),
  // O comparativo faz parte do estado salvo: sem isso, recarregar um cenário
  // devolvia os números mas deixava os cards que estivessem selecionados no
  // momento. Os tickers vão junto porque um id de ativo só resolve com o ativo selecionado.
  compare: i.selected.map(s => s.result.id),
  // Ativo entra só pelo ticker: "BBAS3 · Banco do Brasil" estoura a linha da lista, que é estreita.
  compareLabels: i.selected
    .map(s => (s.result.isAsset ? s.result.label.split(' · ')[0] : s.result.label))
    .join(' · '),
  stock: i.stock,
  fii: i.fii,
  summary: i.mode === 'meta'
    ? `${brl0(i.monthly)}/mês · ${i.best.label}`
    : `${brl0(i.best.netValue)} · ${i.best.label}`,
});

/**
 * Acrescenta o cenário à lista da aba dele. O corte de 5 é POR ABA: guardar as 5
 * últimas da lista inteira deixaria uma aba comer o espaço da outra.
 */
export const addScenario = (all: Scenario[], entry: Scenario): Scenario[] => [
  ...all.filter(s => s.mode !== entry.mode),
  ...all.filter(s => s.mode === entry.mode).concat([entry]).slice(-5),
];

/** Liga/desliga um instrumento no comparativo: no máximo 3, e o último nunca sai. */
export const toggleCompareList = (prev: string[], id: string): string[] => {
  const next = prev.slice();
  const i = next.indexOf(id);
  if (i >= 0) {
    if (next.length > 1) next.splice(i, 1);
  } else {
    if (next.length >= 3) next.shift();
    next.push(id);
  }
  return next;
};

/** Parâmetros de mercado exibidos: só os que chegaram, mais a TR da poupança. */
export const marketParams = (macro: Record<string, unknown> | null | undefined): { label: string; value: string }[] => {
  const read = (k: string) => (macro?.[k] as { value?: number } | undefined)?.value;
  const prefixado = pickPrefixadoRate((macro?.bonds as MacroBond[]) ?? []);
  const rows: [string, number | null | undefined][] = [
    ['CDI (a.a.)', read('cdi')],
    ['Selic efetiva (a.a.)', read('selic')],
    ['IPCA (a.a.)', read('ipca')],
    ['Juro real IPCA+ (a.a.)', read('ntnbLong')],
    ['Tesouro Prefixado (a.a.)', prefixado],
  ];
  return [
    ...rows.filter((r): r is [string, number] => r[1] != null).map(([label, v]) => ({ label, value: pct(v) })),
    { label: 'TR (a.m.) · Poupança', value: '0,1708%' },
  ];
};

/** Mensagem do lado direito quando não há resultado para mostrar. */
export const emptyResultMessage = (macroLoading: boolean, ratesAvailable: boolean, isMeta: boolean): string => {
  if (!macroLoading && !ratesAvailable) {
    return 'As taxas de mercado (Selic, CDI, IPCA, NTN-B) não chegaram agora. Tente novamente em instantes.';
  }
  return isMeta
    ? 'Informe quanto você quer ter no fim do período para ver o aporte necessário.'
    : 'Informe o investimento inicial ou o aporte mensal para simular.';
};

type DyNote = { tone: 'ok' | 'muted'; text: string } | null;

/** Linha abaixo do seletor de ação/FII: DY atual, sem DY, ou carregando. */
export const dyNote = (ticker: string | null, quote: unknown, dy: number | null): DyNote => {
  if (!ticker) return null;
  if (dy != null) return { tone: 'ok', text: `DY atual: ${pct(dy)}` };
  return { tone: 'muted', text: quote === undefined ? 'Carregando DY…' : 'DY não disponível para este ativo' };
};

/** DY só conta quando a cotação trouxe um número positivo. */
export const dyOf = (quote: { dy?: number } | null | undefined): number | null =>
  quote?.dy !== undefined && quote.dy > 0 ? quote.dy : null;

const irLabelOf = (r: InstrumentResult, months: number) =>
  r.taxExempt ? 'isento' : `${(irRate(months) * 100).toFixed(1).replace('.', ',')}%`;

const rate2 = (v: number) => v.toFixed(2).replace('.', ',');

/** "Por que esse resultado?" — o desconto que pesou em cada tipo de instrumento. */
export const instrumentWhy = (r: InstrumentResult, best: InstrumentResult, months: number): string => {
  const irLabel = irLabelOf(r, months);
  if (r.isAsset) {
    return 'Projeção feita só com o rendimento distribuído (DY atual), sem variação de preço da cota. É uma referência de renda, não um valor de resgate contratado.';
  }
  if (r.id === 'poupanca') {
    return `Rende 0,5% ao mês mais TR e não paga imposto, mas é o piso do mercado: fica ${brl0(best.netValue - r.netValue)} atrás do topo neste prazo.`;
  }
  if (r.taxExempt) {
    return `Isenta de imposto de renda para pessoa física. Mesmo rendendo ${LCI_PCT * 100}% do CDI, o que aparece aqui é o que entra na sua conta.`;
  }
  if (r.id === 'fundo-di') {
    return `A taxa de administração de ${rate2(FUNDO_DI_ADMIN)}% a.a. tirou ${brl0(r.costs)} e o IR de ${irLabel} levou ${brl0(r.ir)} do ganho.`;
  }
  if (r.costs > 0.01) {
    return `A custódia da B3 de ${rate2(CUSTODY)}% a.a. custou ${brl0(r.costs)} e o IR de ${irLabel} levou ${brl0(r.ir)}. Sobrou ${brl0(r.netValue)}.`;
  }
  return `Sem custódia nem taxa de administração. O único desconto é o IR de ${irLabel} sobre o ganho, que levou ${brl0(r.ir)}.`;
};

interface Cell { value: string; tone: string }

const costsCell = (r: InstrumentResult): Cell =>
  r.costs > 0.01 ? { value: `−${brl(r.costs)}`, tone: 'text-slate-400' } : { value: '—', tone: 'text-slate-600' };
const irCell = (r: InstrumentResult): Cell =>
  r.ir > 0.01 ? { value: `−${brl(r.ir)}`, tone: 'text-red-300' } : { value: 'isento', tone: 'text-emerald-300' };
const gainCell = (r: InstrumentResult): Cell => ({ value: `+${brl(r.netGain)}`, tone: 'text-emerald-400' });

/** Detalhamento do card: do valor bruto ao ganho líquido. */
export const instrumentDetailRows = (r: InstrumentResult, months: number): ({ label: string } & Cell)[] => [
  { label: 'Valor bruto', value: brl(r.grossValue), tone: 'text-slate-200' },
  { label: 'Rent. bruta', value: pct(r.grossReturn), tone: 'text-slate-400' },
  { label: 'Custos', ...costsCell(r) },
  { label: `IR pago (${irLabelOf(r, months)})`, ...irCell(r) },
  { label: 'Ganho líquido', ...gainCell(r) },
];

/** Linhas do comparativo lado a lado. */
export const COMPARE_ROWS: { label: string; cell: (r: InstrumentResult) => Cell }[] = [
  { label: 'Valor bruto', cell: r => ({ value: brl(r.grossValue), tone: 'text-slate-200' }) },
  { label: 'Custos', cell: costsCell },
  { label: 'IR pago', cell: irCell },
  { label: 'Valor líquido', cell: r => ({ value: brl(r.netValue), tone: 'text-white font-semibold' }) },
  { label: 'Rent. líquida', cell: r => ({ value: pct(r.netReturn), tone: 'text-sky-400' }) },
  { label: 'Ganho líquido', cell: gainCell },
];

/** Largura (%) da barra do card, proporcional ao melhor — com um mínimo visível. */
export const barWidth = (netValue: number, maxNet: number): string =>
  `${(Math.max(0.04, maxNet > 0 ? netValue / maxNet : 0) * 100).toFixed(1)}%`;

/** Barra do destaque: quanto do valor líquido é aporte e quanto é juro. */
export const investedVsGain = (best: InstrumentResult) => {
  const base = Math.max(1, best.netValue);
  return {
    invested: `${((best.invested / base) * 100).toFixed(1)}%`,
    gain: `${((Math.max(0, best.netGain) / base) * 100).toFixed(1)}%`,
  };
};
