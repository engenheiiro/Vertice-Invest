/**
 * Números da Calculadora: listas curadas, juros compostos, IR regressivo,
 * ranking dos instrumentos, bisseção da meta e formatação. Sem React.
 */

// ─── Listas curadas ───────────────────────────────────────────────────────────

export const POPULAR_STOCKS = [
  { ticker: 'BBAS3', name: 'Banco do Brasil' },
  { ticker: 'ITUB4', name: 'Itaú Unibanco' },
  { ticker: 'VALE3', name: 'Vale' },
  { ticker: 'PETR4', name: 'Petrobras' },
  { ticker: 'WEGE3', name: 'WEG' },
  { ticker: 'EGIE3', name: 'Engie Brasil' },
  { ticker: 'TAEE11', name: 'Taesa' },
  { ticker: 'CMIG4', name: 'Cemig' },
  { ticker: 'VIVT3', name: 'TIM Brasil' },
  { ticker: 'ABEV3', name: 'Ambev' },
  { ticker: 'BBDC4', name: 'Bradesco' },
  { ticker: 'RADL3', name: 'Raia Drogasil' },
  { ticker: 'KLBN11', name: 'Klabin' },
  { ticker: 'SUZB3', name: 'Suzano' },
  { ticker: 'PRIO3', name: 'PetroRio' },
  { ticker: 'FLRY3', name: 'Fleury' },
  { ticker: 'SAPR11', name: 'Sanepar' },
  { ticker: 'SBSP3', name: 'Sabesp' },
  { ticker: 'LREN3', name: 'Lojas Renner' },
  { ticker: 'RENT3', name: 'Localiza' },
];

export const POPULAR_FIIS = [
  { ticker: 'HGLG11', name: 'CSHG Logística' },
  { ticker: 'XPML11', name: 'XP Malls' },
  { ticker: 'KNRI11', name: 'Kinea Renda Imob.' },
  { ticker: 'MXRF11', name: 'Maxi Renda' },
  { ticker: 'HGRE11', name: 'CSHG Real Estate' },
  { ticker: 'BCFF11', name: 'BTG Fundo de Fundos' },
  { ticker: 'XPLG11', name: 'XP Log' },
  { ticker: 'BTLG11', name: 'BTG Logístico' },
  { ticker: 'VILG11', name: 'Vinci Logística' },
  { ticker: 'HGBS11', name: 'Hedge Brasil Shopping' },
  { ticker: 'VISC11', name: 'Vinci Shopping' },
  { ticker: 'KNCR11', name: 'Kinea Rendimentos' },
  { ticker: 'RECT11', name: 'REC Renda' },
  { ticker: 'IRDM11', name: 'Iridium Recebíveis' },
  { ticker: 'RBRF11', name: 'RBR Alpha' },
];

export interface InstrumentResult {
  id: string;
  label: string;
  /** Linha curta que explica a taxa usada — "100% do CDI", "Selic + custódia B3". */
  sub: string;
  grossValue: number;
  costs: number;
  ir: number;
  netValue: number;
  grossReturn: number;
  netReturn: number;
  netGain: number;
  invested: number;
  taxExempt: boolean;
  isAsset: boolean;
  /** Patrimônio LÍQUIDO mês a mês (índice 0 = hoje). Base do gráfico de evolução. */
  series: number[];
}

// ─── Funções de cálculo ───────────────────────────────────────────────────────

function fv(rate: number, n: number, pv: number, pmt: number): number {
  if (rate === 0 || !isFinite(rate)) return pv + pmt * n;
  return pv * Math.pow(1 + rate, n) + (pmt * (Math.pow(1 + rate, n) - 1)) / rate;
}

export function irRate(months: number): number {
  if (months <= 6) return 0.225;
  if (months <= 12) return 0.20;
  if (months <= 24) return 0.175;
  return 0.15;
}

function annualToMonthly(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

function calcInstrument(
  id: string,
  label: string,
  sub: string,
  grossRateAnnual: number,
  netRateAnnual: number,
  initial: number,
  monthly: number,
  months: number,
  exempt: boolean,
  isAsset = false,
): InstrumentResult {
  const rGross = annualToMonthly(grossRateAnnual);
  const rNet = annualToMonthly(netRateAnnual);
  const totalInvested = initial + monthly * months;

  const grossValue = fv(rGross, months, initial, monthly);
  const netOfCost = fv(rNet, months, initial, monthly);
  const costs = Math.max(0, grossValue - netOfCost);

  const taxableGain = Math.max(0, netOfCost - totalInvested);
  const ir = exempt ? 0 : taxableGain * irRate(months);
  const netValue = netOfCost - ir;

  const grossReturn = totalInvested > 0 ? ((grossValue / totalInvested) - 1) * 100 : 0;
  const netReturn = totalInvested > 0 ? ((netValue / totalInvested) - 1) * 100 : 0;
  const netGain = netValue - totalInvested;

  // Curva de resgate: quanto sobraria se o dinheiro fosse sacado NAQUELE mês — por
  // isso o IR de cada ponto usa a alíquota do mês corrente, não a do fim do prazo.
  const series: number[] = [];
  for (let m = 0; m <= months; m++) {
    const balance = fv(rNet, m, initial, monthly);
    const invested = initial + monthly * m;
    const taxable = Math.max(0, balance - invested);
    series.push(balance - (exempt ? 0 : taxable * irRate(m)));
  }

  return {
    id, label, sub, grossValue, costs, ir, netValue, grossReturn, netReturn, netGain,
    invested: totalInvested, taxExempt: exempt, isAsset, series,
  };
}

export type MacroBond = { title?: string; type?: string; rate?: number; annualRate?: number };

/**
 * Prefixado de referência da simulação: o Tesouro Prefixado simples. O título com
 * juros semestrais paga cupom no caminho e não capitaliza a taxa cheia, então não
 * espelha um aporte que fica rendendo até o vencimento.
 *
 * "Juros Semestrais" está no NOME do título; `type` é o enum do catálogo
 * (`PREFIXADO`), onde a palavra nunca aparece — filtrar `type` por "juros" não
 * excluía nada.
 */
export const pickPrefixadoRate = (bonds: MacroBond[]): number | undefined => {
  const bond = bonds.find(
    b => (b.type ?? '').toUpperCase() === 'PREFIXADO' && !/juros/i.test(b.title ?? '')
  );
  return bond?.rate ?? bond?.annualRate;
};

export const CUSTODY = 0.20;
export const FUNDO_DI_ADMIN = 0.25;
export const LCI_PCT = 0.85;
const FUNDO_CDI_PCT = 0.9817;

/** Taxas do macro — ou null se QUALQUER uma faltar (nunca um número inventado). */
export function macroRates(macro: Record<string, unknown> | null | undefined) {
  const read = (k: string) => (macro?.[k] as { value?: number } | undefined)?.value;
  const selic = read('selic');
  const cdi = read('cdi');
  const ipca = read('ipca');
  const ntnbLong = read('ntnbLong');
  const ok = [selic, cdi, ipca, ntnbLong].every((v) => typeof v === 'number' && Number.isFinite(v));
  return ok ? { selic: selic as number, cdi: cdi as number, ipca: ipca as number, ntnbLong: ntnbLong as number } : null;
}

const rateLabel = (v: number) => `${v.toFixed(2).replace('.', ',')}%`;

export function calcAll(
  initial: number,
  monthly: number,
  months: number,
  macro: Record<string, unknown> | null | undefined,
  stockDy: number | null,
  fiiDy: number | null,
  selectedStock: string | null,
  selectedFii: string | null,
): InstrumentResult[] {
  if (months === 0 || (initial <= 0 && monthly <= 0)) return [];

  // Sem taxa real não há simulação: o fallback antigo (14,40 / 4,62 / 6,50)
  // calculava todos os resultados e o "melhor investimento" com números fixos,
  // sob o selo AO VIVO. Fail-closed — a tela mostra que as taxas não chegaram.
  const rates = macroRates(macro);
  if (!rates) return [];
  const { selic, cdi, ipca, ntnbLong } = rates;

  const bonds = (macro?.bonds as MacroBond[]) ?? [];
  const prefixado = pickPrefixadoRate(bonds) ?? Math.max(selic - 0.5, 8);

  const trMonthly = 0.1708;
  const poupancaMonthlyPct = selic > 8.5 ? 0.5 + trMonthly : (selic * 0.70) / 12;
  const poupancaAnnual = (Math.pow(1 + poupancaMonthlyPct / 100, 12) - 1) * 100;
  const ipcaPlus = ((1 + ipca / 100) * (1 + ntnbLong / 100) - 1) * 100;


  const results: InstrumentResult[] = [
    calcInstrument('cdb', 'CDB', '100% do CDI', cdi, cdi, initial, monthly, months, false),
    calcInstrument('tesouro-selic', 'Tesouro Selic', 'Selic + custódia B3', selic, selic - CUSTODY, initial, monthly, months, false),
    calcInstrument('prefixado', 'Tesouro Prefixado', `${rateLabel(prefixado)} a.a. travado`, prefixado, prefixado - CUSTODY, initial, monthly, months, false),
    calcInstrument('lci-lca', 'LCI e LCA', '85% do CDI', cdi * LCI_PCT, cdi * LCI_PCT, initial, monthly, months, true),
    calcInstrument('fundo-di', 'Fundo DI', '98% do CDI · taxa 0,25%', cdi * FUNDO_CDI_PCT, cdi * FUNDO_CDI_PCT - FUNDO_DI_ADMIN, initial, monthly, months, false),
    calcInstrument('ipca-plus', 'Tesouro IPCA+', `IPCA + ${rateLabel(ntnbLong)}`, ipcaPlus, ipcaPlus - CUSTODY, initial, monthly, months, false),
    calcInstrument('poupanca', 'Poupança', `${poupancaMonthlyPct.toFixed(2).replace('.', ',')}% a.m. com TR`, poupancaAnnual, poupancaAnnual, initial, monthly, months, true),
  ];

  const stock = assetInstrument('stock', 'Só dividendos', POPULAR_STOCKS, selectedStock, stockDy, initial, monthly, months);
  if (stock) results.push(stock);
  const fii = assetInstrument('fii', 'Só rendimentos', POPULAR_FIIS, selectedFii, fiiDy, initial, monthly, months);
  if (fii) results.push(fii);

  return results.sort((a, b) => b.netValue - a.netValue);
}

/** Ação ou FII projetado só pelo DY corrente — fica de fora sem ticker ou sem DY > 0. */
function assetInstrument(
  prefix: 'stock' | 'fii',
  income: string,
  list: { ticker: string; name: string }[],
  ticker: string | null,
  dy: number | null,
  initial: number,
  monthly: number,
  months: number,
): InstrumentResult | null {
  if (!ticker || dy == null || dy <= 0) return null;
  const name = list.find(a => a.ticker === ticker)?.name ?? ticker;
  return calcInstrument(`${prefix}-${ticker}`, `${ticker} · ${name}`, `${income} · DY ${rateLabel(dy)}`, dy, dy, initial, monthly, months, true, true);
}

/**
 * Aporte mensal necessário para chegar na meta, por bisseção sobre o MELHOR
 * instrumento de renda fixa do período. Ação e FII ficam fora da busca: a projeção
 * deles é só o DY corrente, não um valor de resgate contratado.
 */
export function neededMonthly(
  goal: number,
  initial: number,
  months: number,
  macro: Record<string, unknown> | null | undefined,
): { value: number; instrument: InstrumentResult } | null {
  const probe = calcAll(initial, 1000, months, macro, null, null, null, null).filter(r => !r.isAsset);
  if (!probe.length) return null;
  const bestId = probe[0].id;

  let lo = 0;
  let hi = 200000;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const run = calcAll(initial, mid, months, macro, null, null, null, null).find(r => r.id === bestId);
    if (!run) break;
    if (run.netValue < goal) lo = mid; else hi = mid;
  }
  const value = Math.ceil(hi / 10) * 10;
  const instrument = calcAll(initial, value, months, macro, null, null, null, null).find(r => r.id === bestId);
  return instrument ? { value, instrument } : null;
}

// ─── Formatação ───────────────────────────────────────────────────────────────

/** Moeda com centavos — "R$ 1.234,56". */
export const brl = (n: number) =>
  `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Moeda arredondada — "R$ 1.235". Usada onde o centavo só polui a leitura. */
export const brl0 = (n: number) =>
  `R$ ${Math.round(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;

/** Escala curta do eixo do gráfico e dos chips — "R$ 120k", "R$ 1,4M". */
export const compact = (n: number) => {
  if (n >= 1000000) return `R$ ${(n / 1000000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1000) return `R$ ${Math.round(n / 1000)}k`;
  return `R$ ${Math.round(n)}`;
};

export const pct = (n: number) => `${n.toFixed(2).replace('.', ',')}%`;

export function formatPeriod(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} ${m === 1 ? 'mês' : 'meses'}`;
  if (m === 0) return `${y} ${y === 1 ? 'ano' : 'anos'}`;
  return `${y} ${y === 1 ? 'ano' : 'anos'} e ${m} ${m === 1 ? 'mês' : 'meses'}`;
}

/** Rótulo compacto do chip de período — "5a", "18m". */
export const shortPeriod = (months: number) =>
  months % 12 === 0 ? `${months / 12}a` : `${months}m`;

/**
 * Período em forma curta para caber numa linha só — "19a 9m", "5a", "7m".
 * `formatPeriod` por extenso ("19 anos e 9 meses") quebra o tooltip do gráfico.
 */
export function tightPeriod(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y && m) return `${y}a ${m}m`;
  if (y) return `${y}a`;
  return `${m}m`;
}
