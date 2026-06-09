/**
 * Espelho client-side do motor de metas (server/utils/goalMath.js) para previews
 * "what-if" instantâneos enquanto o usuário digita (criar meta / registrar aporte),
 * sem ida ao servidor. O backend continua sendo a fonte da verdade do estado salvo.
 */

/** Taxa anual em % → taxa mensal decimal composta. */
export const annualToMonthly = (annualPct: number): number =>
  Math.pow(1 + (annualPct || 0) / 100, 1 / 12) - 1;

/** Valor futuro com aportes mensais. FV = PV·(1+r)^n + PMT·[((1+r)^n−1)/r]. */
export const fv = (rate: number, n: number, pv: number, pmt: number): number => {
  if (rate === 0 || !isFinite(rate)) return pv + pmt * n;
  return pv * Math.pow(1 + rate, n) + (pmt * (Math.pow(1 + rate, n) - 1)) / rate;
};

/** Meses até atingir a meta. 0 se já atingiu, Infinity se não há crescimento. */
export const monthsRemaining = (
  pv: number,
  pmt: number,
  annualRate: number,
  target: number,
): number => {
  const PV = pv || 0;
  const PMT = pmt || 0;
  const FV = target || 0;
  const r = annualToMonthly(annualRate);

  if (FV <= 0) return 0;
  if (PV >= FV) return 0;
  if (r === 0) return PMT <= 0 ? Infinity : (FV - PV) / PMT;
  if (PMT <= 0 && PV <= 0) return Infinity;

  const numerator = FV * r + PMT;
  const denominator = PV * r + PMT;
  if (denominator <= 0) return Infinity;
  const ratio = numerator / denominator;
  if (ratio <= 1) return 0;
  const n = Math.log(ratio) / Math.log(1 + r);
  return isFinite(n) && n > 0 ? n : Infinity;
};

/** Aporte mensal necessário para bater a meta em N meses (prazo fixo). */
export const requiredMonthly = (
  pv: number,
  annualRate: number,
  target: number,
  monthsToDeadline: number,
): number => {
  const PV = pv || 0;
  const FV = target || 0;
  const N = monthsToDeadline || 0;
  const r = annualToMonthly(annualRate);

  if (N <= 0) return Infinity;
  if (FV <= PV) return 0;
  if (r === 0) return (FV - PV) / N;

  const fvFromPv = PV * Math.pow(1 + r, N);
  if (fvFromPv >= FV) return 0;
  const pmt = ((FV - fvFromPv) * r) / (Math.pow(1 + r, N) - 1);
  return pmt > 0 ? pmt : 0;
};

/** Meses economizados ao aumentar o aporte mensal em `deltaPmt` (simulador what-if). */
export const monthsSaved = (
  pv: number,
  pmt: number,
  annualRate: number,
  target: number,
  deltaPmt: number,
): number => {
  const base = monthsRemaining(pv, pmt, annualRate, target);
  const faster = monthsRemaining(pv, (pmt || 0) + (deltaPmt || 0), annualRate, target);
  if (!isFinite(base)) return isFinite(faster) ? Infinity : 0;
  if (!isFinite(faster)) return 0;
  const saved = base - faster;
  return saved > 0 ? saved : 0;
};

/** Soma N meses (fracionário ≈ 30 dias) a uma data. */
export const addMonths = (base: Date, months: number): Date | null => {
  if (!isFinite(months)) return null;
  const d = new Date(base);
  const whole = Math.floor(months);
  const frac = months - whole;
  d.setMonth(d.getMonth() + whole);
  d.setDate(d.getDate() + Math.round(frac * 30));
  return d;
};
