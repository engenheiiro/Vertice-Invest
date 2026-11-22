
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { researchService } from '../services/research';
import { authService } from '../services/auth';
import {
  POPULAR_STOCKS, POPULAR_FIIS, calcAll, neededMonthly, macroRates,
  brl, brl0, compact, pct, formatPeriod, shortPeriod, tightPeriod, type InstrumentResult,
} from './calculatorMath';
import {
  normalizeScenario, scenarioTitle, buildScenario, addScenario, toggleCompareList, marketParams, emptyResultMessage,
  dyNote, dyOf, instrumentWhy, instrumentDetailRows, COMPARE_ROWS, barWidth, investedVsGain,
  type CalcMode, type Scenario, type SelectedSeries,
} from './calculatorView';

// ─── Componentes auxiliares ───────────────────────────────────────────────────

const SERIES_COLORS = ['#38bdf8', '#34d399', '#f0a742'];

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold font-mono border transition-colors ${
        active
          ? 'border-sky-400/40 bg-sky-400/15 text-sky-300'
          : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:border-white/20'
      }`}
    >
      {label}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] tracking-[0.17em] text-slate-500 font-bold">{children}</div>;
}

/**
 * Trilho desenhado + `input[type=range]` transparente por cima: o visual segue o
 * mockup e o arrasto, o toque e o teclado continuam sendo os nativos do browser.
 */
function Slider({
  value, min, max, step, onChange, ariaLabel,
}: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; ariaLabel: string }) {
  const share = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const pctStr = `${(share * 100).toFixed(1)}%`;
  return (
    <div className="relative h-[30px] flex items-center">
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-sky-600 to-sky-400" style={{ width: pctStr }} />
      </div>
      <div
        className="absolute top-1/2 w-[17px] h-[17px] rounded-full bg-slate-100 border-2 border-card shadow-[0_0_0_4px_rgba(56,189,248,0.18)] pointer-events-none"
        style={{ left: pctStr, transform: 'translate(-50%,-50%)' }}
      />
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  );
}

/** Campo de dinheiro em reais inteiros, com o "R$" fixo dentro da moldura. */
function MoneyField({
  value, onChange, accent, ariaLabel,
}: { value: number; onChange: (v: number) => void; accent?: 'amber'; ariaLabel: string }) {
  const parse = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    return digits ? Math.min(50000000, parseInt(digits, 10)) : 0;
  };
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-[13px] text-slate-500 pointer-events-none">R$</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        // Zero aparece como campo VAZIO com placeholder: a página abre sem nada
        // preenchido, e um "0" digitado seria indistinguível do estado inicial.
        value={value > 0 ? value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : ''}
        placeholder="0"
        onChange={e => onChange(parse(e.target.value))}
        // `text-[16px]` e não `text-base`: o design system registra uma COR chamada
        // `base`, então a classe `text-base` também gera uma regra de `color` que
        // briga com o `text-amber-300`/`text-white` daqui — o campo da meta saía
        // pintado com a cor de superfície.
        className={`w-full pl-10 pr-3.5 py-3 rounded-xl bg-deep border font-mono text-[16px] font-medium outline-none transition-colors ${
          accent === 'amber'
            ? 'border-amber-400/30 text-amber-300 focus:border-amber-400'
            : 'border-white/10 text-white focus:border-sky-400'
        }`}
      />
    </div>
  );
}

function AssetSelect({
  label, options, value, onChange,
}: {
  label: string;
  options: { ticker: string; name: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <label className="block text-[12.5px] text-slate-400 mb-1.5">{label}</label>
      <div className="relative">
        <select aria-label={label}
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          className="w-full appearance-none bg-deep border border-white/10 focus:border-purple-500/50 focus:outline-none rounded-xl px-3.5 py-2.5 text-sm text-white transition-colors pr-8"
        >
          <option value="">— Não comparar —</option>
          {options.map(o => (
            <option key={o.ticker} value={o.ticker}>{o.ticker} · {o.name}</option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Gráfico de evolução ──────────────────────────────────────────────────────

const CHART_W = 760;
const CHART_H = 222;
const CHART_PAD_TOP = 14;

function EvolutionChart({
  selected, months,
}: { selected: { result: InstrumentResult; color: string }[]; months: number }) {
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    const last = selected.map(s => s.result.series[s.result.series.length - 1] ?? 0);
    const allMax = Math.max(1, ...last);
    const step = Math.pow(10, Math.floor(Math.log10(allMax)));
    const top = Math.ceil(allMax / (step / 2)) * (step / 2);
    const xOf = (i: number) => (i / Math.max(1, months)) * CHART_W;
    const yOf = (v: number) => CHART_PAD_TOP + (1 - v / top) * (CHART_H - CHART_PAD_TOP);

    const series = selected.map((s, idx) => {
      const points = s.result.series.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`);
      const line = `M${points.join(' L')}`;
      return {
        id: s.result.id,
        color: s.color,
        line,
        area: idx === 0 ? `${line} L${CHART_W},${CHART_H} L0,${CHART_H} Z` : '',
      };
    });

    const gridLines = [1, 2, 3, 4].map(k => {
      const v = (top / 4) * k;
      const y = yOf(v);
      return { key: k, y: y.toFixed(1), top: `${(y - 13).toFixed(1)}px`, label: compact(v) };
    });

    const xLabels: { left: string; label: string }[] = [];
    const yearsTotal = months / 12;
    const tickYears = yearsTotal <= 2 ? Math.max(1, Math.round(months / 4)) / 12 : Math.ceil(yearsTotal / 5);
    for (let t = 0; t <= yearsTotal + 0.001; t += tickYears) {
      const idx = Math.round(t * 12);
      if (idx > months) break;
      xLabels.push({
        left: `${((xOf(idx) / CHART_W) * 100).toFixed(2)}%`,
        label: t < 1 ? `${Math.round(t * 12)}m` : `${Math.round(t)}a`,
      });
    }
    if (xLabels.length && parseFloat(xLabels[xLabels.length - 1].left) < 94) {
      xLabels.push({
        left: '99%',
        label: yearsTotal < 1
          ? `${months}m`
          : `${yearsTotal % 1 === 0 ? yearsTotal : yearsTotal.toFixed(1).replace('.', ',')}a`,
      });
    }

    return { xOf, yOf, series, gridLines, xLabels };
  }, [selected, months]);

  const hoverIdx = hover === null ? null : Math.max(0, Math.min(months, Math.round(hover * months)));
  const hoverOn = hoverIdx !== null && selected.length > 0;

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  }, []);

  return (
    <div className="relative mt-3.5" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${CHART_W} 250`}
        preserveAspectRatio="none"
        className="w-full h-[250px] block overflow-visible"
        role="img"
        aria-label="Evolução do patrimônio líquido dos instrumentos selecionados"
      >
        {geom.gridLines.map(g => (
          <line key={g.key} x1="0" y1={g.y} x2={CHART_W} y2={g.y} stroke="rgba(148,163,184,0.16)" strokeWidth="1" />
        ))}
        {geom.series.map(s => (
          <g key={s.id}>
            {s.area && <path d={s.area} fill="rgba(56,189,248,0.10)" stroke="none" />}
            <path d={s.line} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
        {hoverOn && hoverIdx !== null && (
          <g>
            <line
              x1={geom.xOf(hoverIdx)} y1="0" x2={geom.xOf(hoverIdx)} y2={CHART_H}
              stroke="rgba(148,163,184,0.45)" strokeWidth="1" strokeDasharray="3 3"
            />
            {selected.map(s => (
              <circle
                key={s.result.id}
                cx={geom.xOf(hoverIdx)}
                cy={geom.yOf(s.result.series[hoverIdx] ?? 0)}
                r="4.5"
                fill={s.color}
                stroke="rgb(var(--tw-color-card))"
                strokeWidth="2"
              />
            ))}
          </g>
        )}
      </svg>

      <div className="absolute inset-0 pointer-events-none">
        {geom.gridLines.map(g => (
          <div key={g.key} className="absolute left-0.5 font-mono text-[10px] text-slate-500 leading-none" style={{ top: g.top }}>
            {g.label}
          </div>
        ))}
        {geom.xLabels.map((x, i) => (
          <div
            key={i}
            className="absolute top-[234px] -translate-x-1/2 font-mono text-[10.5px] text-slate-500 leading-none whitespace-nowrap"
            style={{ left: x.left }}
          >
            {x.label}
          </div>
        ))}
      </div>

      {hoverOn && hoverIdx !== null && (
        <div
          className="absolute top-1.5 -translate-x-1/2 pointer-events-none w-max px-3 py-2.5 rounded-xl bg-panel border border-white/10 shadow-2xl"
          // Preso entre 14% e 86%: sem a trava, o tooltip centrado no cursor
          // escapa da borda do card nas pontas do gráfico.
          style={{ left: `${Math.min(86, Math.max(14, (geom.xOf(hoverIdx) / CHART_W) * 100)).toFixed(1)}%` }}
        >
          <div className="text-[10.5px] tracking-[0.1em] text-slate-500 font-bold mb-2 whitespace-nowrap">
            MÊS {hoverIdx} · {tightPeriod(hoverIdx)}
          </div>
          {selected.map(s => (
            <div key={s.result.id} className="flex items-center gap-3 mt-1.5">
              <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-[11.5px] text-slate-400 flex-1 whitespace-nowrap">{s.result.label}</span>
              <span className="font-mono text-[11.5px] text-white font-medium whitespace-nowrap">{brl0(s.result.series[hoverIdx] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Card de instrumento ──────────────────────────────────────────────────────

function CompareToggle({ color, onClick }: { color: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10.5px] font-semibold px-2 py-1 rounded-md whitespace-nowrap border transition-colors ${
        color ? '' : 'border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'
      }`}
      style={color ? { borderColor: `${color}66`, background: `${color}1f`, color } : undefined}
    >
      {color ? 'no gráfico' : 'comparar'}
    </button>
  );
}

function InstrumentDetail({ result, months, best }: { result: InstrumentResult; months: number; best: InstrumentResult }) {
  return (
    <div className="border-t border-dashed border-white/10 pt-3 animate-fade-in">
      {instrumentDetailRows(result, months).map(row => (
        <div key={row.label} className="flex justify-between items-baseline py-[5px]">
          <span className="text-xs text-slate-400">{row.label}</span>
          <span className={`font-mono text-[12.5px] font-medium ${row.tone}`}>{row.value}</span>
        </div>
      ))}
      <p className="mt-2.5 text-xs leading-relaxed text-slate-500">{instrumentWhy(result, best, months)}</p>
    </div>
  );
}

const barTone = (isTop: boolean, selectedColor: string | null) => {
  if (isTop) return 'bg-gradient-to-r from-emerald-400 to-emerald-300';
  return selectedColor ? '' : 'bg-slate-600';
};

function InstrumentCard({
  result, rank, isTop, maxNet, months, best, selectedColor, expanded, onToggle, onCompare,
}: {
  result: InstrumentResult;
  rank: number;
  isTop: boolean;
  maxNet: number;
  months: number;
  best: InstrumentResult;
  selectedColor: string | null;
  expanded: boolean;
  onToggle: () => void;
  onCompare: () => void;
}) {
  // Cor do comparativo só tinge o card que não é o primeiro (esse já tem o verde).
  const tint = selectedColor && !isTop ? selectedColor : null;

  return (
    <div
      className={`rounded-2xl border p-[17px] flex flex-col gap-3 transition-colors ${
        isTop
          ? 'border-emerald-400/30 bg-gradient-to-br from-emerald-400/[0.09] to-card'
          : 'bg-card border-white/[0.07]'
      }`}
      style={tint ? { borderColor: `${tint}55` } : undefined}
    >
      <div className="flex items-start gap-2.5">
        <div className="font-mono text-[11px] text-slate-600 w-4 pt-0.5">{String(rank).padStart(2, '0')}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[14.5px] font-semibold ${result.isAsset ? 'text-purple-300' : 'text-white'}`}>{result.label}</span>
            {result.taxExempt && !result.isAsset && (
              <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-300 border border-emerald-400/25 whitespace-nowrap">
                ISENTO DE IR
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-slate-500 mt-1">{result.sub}</div>
        </div>
        <CompareToggle color={selectedColor} onClick={onCompare} />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[19px] font-semibold text-white tracking-tight">{brl(result.netValue)}</span>
          <span className="font-mono text-[12.5px] text-emerald-400 font-medium">{pct(result.netReturn)}</span>
        </div>
        <div className="h-[5px] rounded-full bg-white/[0.06] mt-2.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barTone(isTop, selectedColor)}`}
            style={{ width: barWidth(result.netValue, maxNet), ...(tint ? { background: tint } : {}) }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between text-[11.5px] text-sky-300 hover:text-sky-200 font-semibold pt-0.5 transition-colors"
      >
        <span>{expanded ? 'Fechar detalhamento' : 'Por que esse resultado?'}</span>
        <span className="text-sm leading-none">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && <InstrumentDetail result={result} months={months} best={best} />}
    </div>
  );
}

// ─── Cenários salvos e cotações ───────────────────────────────────────────────

const SCENARIOS_KEY = 'vertice_calc_scenarios_v1';

/** Cenários no localStorage: storage indisponível ou corrompido deixa a lista só na sessão. */
function useSavedScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCENARIOS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setScenarios(parsed.map(normalizeScenario));
      }
    } catch { /* storage indisponível — cenários ficam só na sessão */ }
  }, []);

  const persist = (list: Scenario[]) => {
    setScenarios(list);
    try { localStorage.setItem(SCENARIOS_KEY, JSON.stringify(list)); } catch { /* idem */ }
  };

  return [scenarios, persist] as const;
}

/** Cotação do ativo comparado (undefined enquanto carrega; null quando a API falha). */
function useQuote(ticker: string | null) {
  const { data } = useQuery({
    queryKey: ['quote', ticker],
    queryFn: async () => {
      const r = await authService.api(`/api/market/quote?ticker=${ticker}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!ticker,
    staleTime: 5 * 60 * 1000,
  });
  return data;
}

// ─── Coluna esquerda ──────────────────────────────────────────────────────────

const tabClass = (active: boolean) =>
  `px-4 py-2.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-colors ${
    active ? 'bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/30' : 'text-slate-400 hover:text-slate-200'
  }`;

function PageHeading({ isMeta, onMode }: { isMeta: boolean; onMode: (m: CalcMode) => void }) {
  return (
    <div className="flex items-end gap-6 flex-wrap mb-6">
      <div className="flex-1 min-w-[300px]">
        <div className="flex items-center gap-2.5 text-[11px] tracking-[0.16em] text-slate-500 font-semibold mb-2.5">
          FERRAMENTAS
          <span className="w-3.5 h-px bg-slate-600" />
          <span className="text-sky-400">CALCULADORA</span>
        </div>
        <h1 className="text-[clamp(28px,4.4vw,44px)] font-bold tracking-[-0.028em] leading-[1.05]">
          Quanto o seu dinheiro<br />
          <span className="text-sky-400">rende de verdade</span>
        </h1>
        <p className="mt-3 text-[14.5px] text-slate-400 max-w-[52ch]">
          Compare os instrumentos de renda fixa com as taxas de mercado de hoje, já descontando imposto de renda e custos.
          Mexa nos controles e veja o resultado mudar na hora.
        </p>
      </div>

      <div className="flex p-1 rounded-xl bg-card border border-white/[0.07] gap-1">
        <button type="button" onClick={() => onMode('simular')} className={tabClass(!isMeta)}>Simular aportes</button>
        <button type="button" onClick={() => onMode('meta')} className={tabClass(isMeta)}>Chegar na meta</button>
      </div>
    </div>
  );
}

type Need = ReturnType<typeof neededMonthly>;

function GoalNeed({ need, periodMonths, goal }: { need: Need; periodMonths: number; goal: number }) {
  return (
    <div className="mt-4 p-4 rounded-xl bg-amber-400/[0.07] border border-amber-400/20">
      <div className="text-[10.5px] tracking-[0.14em] text-amber-500 font-bold mb-2">APORTE MENSAL NECESSÁRIO</div>
      <div className="font-mono text-[26px] font-semibold text-amber-300 tracking-tight">
        {need ? `${brl0(need.value)}/mês` : '—'}
      </div>
      <div className="text-xs text-slate-400 mt-2">
        {need
          ? `Aportando esse valor por ${formatPeriod(periodMonths)} em ${need.instrument.label}, você chega a ${brl0(goal)} líquidos.`
          : 'Informe quanto você quer ter no fim do período para calcular o aporte.'}
      </div>
    </div>
  );
}

interface ConfigProps {
  isMeta: boolean;
  initial: number; setInitial: (v: number) => void;
  monthly: number; setMonthly: (v: number) => void;
  goal: number; setGoal: (v: number) => void;
  periodMonths: number; setPeriodMonths: (v: number) => void;
  totalInvested: number;
  need: Need;
}

function ConfigSection({ isMeta, initial, setInitial, monthly, setMonthly, goal, setGoal, periodMonths, setPeriodMonths, totalInvested, need }: ConfigProps) {
  return (
    <section className="rounded-[18px] bg-card border border-white/[0.08] p-[22px] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)]">
      <div className="mb-[18px]"><SectionTitle>CONFIGURAÇÃO</SectionTitle></div>

      <span className="block text-[12.5px] text-slate-400 mb-1.5">Investimento inicial</span>
      <div className="mb-2">
        <MoneyField value={initial} onChange={setInitial} ariaLabel="Investimento inicial" />
      </div>
      <div className="flex gap-1.5 flex-wrap mb-5">
        {[1000, 10000, 20000, 50000].map(v => (
          <Chip key={v} label={compact(v)} active={initial === v} onClick={() => setInitial(v)} />
        ))}
      </div>

      {!isMeta && (
        <div>
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-[12.5px] text-slate-400">Aportes mensais</span>
            <span className="font-mono text-[15px] font-semibold text-white">{brl0(monthly)}</span>
          </div>
          <Slider value={monthly} min={0} max={10000} step={50} onChange={setMonthly} ariaLabel="Aportes mensais" />
          <div className="flex gap-1.5 flex-wrap mt-2 mb-5">
            {[500, 1000, 2000, 5000].map(v => (
              <Chip key={v} label={compact(v)} active={monthly === v} onClick={() => setMonthly(v)} />
            ))}
          </div>
        </div>
      )}

      {isMeta && (
        <div>
          <span className="block text-[12.5px] text-slate-400 mb-1.5">Quero chegar em</span>
          <div className="mb-5">
            <MoneyField value={goal} onChange={setGoal} accent="amber" ariaLabel="Meta de patrimônio" />
          </div>
        </div>
      )}

      <div className="flex justify-between items-baseline mb-2">
        <span className="text-[12.5px] text-slate-400">Período da aplicação</span>
        <span className="font-mono text-[15px] font-semibold text-white">{formatPeriod(periodMonths)}</span>
      </div>
      <Slider value={periodMonths} min={1} max={360} step={1} onChange={setPeriodMonths} ariaLabel="Período da aplicação em meses" />
      <div className="flex gap-1.5 flex-wrap mt-2">
        {[12, 24, 60, 120, 240].map(v => (
          <Chip key={v} label={shortPeriod(v)} active={periodMonths === v} onClick={() => setPeriodMonths(v)} />
        ))}
      </div>

      <div className="mt-[22px] pt-[18px] border-t border-dashed border-white/10 flex justify-between items-baseline gap-3">
        <span className="text-[12.5px] text-slate-400">{isMeta ? 'Total aportado na meta' : 'Total investido'}</span>
        <span className="font-mono text-[17px] font-semibold text-white">{brl0(totalInvested)}</span>
      </div>

      {isMeta && <GoalNeed need={need} periodMonths={periodMonths} goal={goal} />}
    </section>
  );
}

function RatesBadge({ ratesAvailable }: { ratesAvailable: boolean }) {
  if (!ratesAvailable) {
    return (
      <div className="flex items-center gap-1.5 text-[10.5px] text-yellow-400 font-semibold">
        <span className="w-[5px] h-[5px] rounded-full bg-yellow-400" />
        INDISPONÍVEL
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] text-emerald-400 font-semibold">
      <span className="w-[5px] h-[5px] rounded-full bg-emerald-400 shadow-[0_0_7px_#34d399]" />
      AO VIVO
    </div>
  );
}

function ParamsSection({ macroLoading, ratesAvailable, params }: { macroLoading: boolean; ratesAvailable: boolean; params: { label: string; value: string }[] }) {
  return (
    <section className="rounded-[18px] bg-card border border-white/[0.07] p-[22px]">
      <div className="flex justify-between items-center mb-4">
        <SectionTitle>PARÂMETROS HOJE</SectionTitle>
        {macroLoading
          ? <div className="w-3 h-3 rounded-full border border-slate-600 border-t-emerald-400 animate-spin" />
          : <RatesBadge ratesAvailable={ratesAvailable} />}
      </div>
      {macroLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-6 bg-white/5 rounded animate-pulse" />)}
        </div>
      ) : (
        <div className="flex flex-col">
          {params.map(p => (
            <div key={p.label} className="flex justify-between items-baseline gap-3 py-2 border-b border-white/5 last:border-0">
              <span className="text-[13px] text-slate-400">{p.label}</span>
              <span className="font-mono text-[13.5px] font-medium text-slate-200">{p.value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DyLine({ note }: { note: ReturnType<typeof dyNote> }) {
  if (!note) return null;
  return <p className={`text-[11px] ${note.tone === 'ok' ? 'text-purple-400' : 'text-slate-500'}`}>{note.text}</p>;
}

interface AssetProps {
  selectedStock: string | null; setSelectedStock: (v: string | null) => void; stockNote: ReturnType<typeof dyNote>;
  selectedFii: string | null; setSelectedFii: (v: string | null) => void; fiiNote: ReturnType<typeof dyNote>;
}

function AssetSection({ selectedStock, setSelectedStock, stockNote, selectedFii, setSelectedFii, fiiNote }: AssetProps) {
  return (
    <section className="rounded-[18px] bg-card border border-white/[0.07] p-[22px] space-y-4">
      <SectionTitle>COMPARAR COM ATIVO</SectionTitle>

      <AssetSelect label="Ação (mais queridas)" options={POPULAR_STOCKS} value={selectedStock} onChange={setSelectedStock} />
      <DyLine note={stockNote} />

      <AssetSelect label="FII (mais queridos)" options={POPULAR_FIIS} value={selectedFii} onChange={setSelectedFii} />
      <DyLine note={fiiNote} />

      {(selectedStock || selectedFii) && (
        <div className="flex gap-2 bg-amber-900/20 border border-amber-700/30 rounded-xl p-3">
          <AlertCircle size={12} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[10px] text-amber-300/80 leading-relaxed">
            Projeção considera apenas o DY atual, sem variação de preço. Rendimento passado não garante retorno futuro.
          </p>
        </div>
      )}
    </section>
  );
}

interface ScenariosProps {
  isMeta: boolean;
  canSave: boolean;
  onSave: () => void;
  list: Scenario[];
  onLoad: (s: Scenario) => void;
  onRemove: (s: Scenario) => void;
}

function ScenariosSection({ isMeta, canSave, onSave, list, onLoad, onRemove }: ScenariosProps) {
  return (
    <section className="rounded-[18px] bg-card border border-white/[0.07] p-[22px]">
      <div className="flex justify-between items-center gap-2.5 mb-3.5">
        <SectionTitle>{isMeta ? 'METAS SALVAS' : 'CENÁRIOS SALVOS'}</SectionTitle>
        <button
          type="button"
          disabled={!canSave}
          onClick={onSave}
          className="text-[11.5px] font-semibold text-sky-300 px-2.5 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 hover:bg-sky-400/20 disabled:opacity-40 transition-colors"
        >
          + Salvar atual
        </button>
      </div>

      {list.length === 0 ? (
        <p className="text-[12.5px] text-slate-500 leading-relaxed">
          {isMeta
            ? 'Salve esta meta para comparar depois com outro prazo ou valor de chegada.'
            : 'Salve a simulação atual para comparar depois com outro prazo ou aporte.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <button type="button" onClick={() => onLoad(s)} className="flex-1 min-w-0 text-left">
                <div className="text-[12.5px] font-semibold text-slate-200 truncate">{scenarioTitle(s)}</div>
                <div className="font-mono text-xs text-emerald-400 mt-0.5 truncate">{s.summary}</div>
                {s.compareLabels && (
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">{s.compareLabels}</div>
                )}
              </button>
              <button
                type="button"
                aria-label={isMeta ? 'Remover meta' : 'Remover cenário'}
                onClick={() => onRemove(s)}
                className="text-[15px] text-slate-600 hover:text-red-400 px-1 transition-colors"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Coluna direita ───────────────────────────────────────────────────────────

function BestHighlight({ best, periodMonths, poupanca }: { best: InstrumentResult; periodMonths: number; poupanca: InstrumentResult | undefined }) {
  const bar = investedVsGain(best);
  return (
    <section className="rounded-[20px] p-[26px] border border-sky-400/20 bg-gradient-to-br from-sky-400/[0.13] via-emerald-400/[0.07] to-card flex gap-7 flex-wrap items-start">
      <div className="flex-1 min-w-[260px]">
        <div className="flex items-center gap-2.5 mb-3 flex-wrap">
          <span className="text-[10px] font-bold tracking-[0.14em] px-2 py-1 rounded-md bg-emerald-400 text-emerald-950">MELHOR OPÇÃO</span>
          <span className="text-[13px] font-semibold text-white">{best.label}</span>
        </div>
        <div className="font-mono text-[clamp(30px,5vw,44px)] font-semibold tracking-[-0.03em] leading-none text-white">
          {brl(best.netValue)}
        </div>
        <div className="text-[13px] text-slate-400 mt-2.5">
          líquido em {formatPeriod(periodMonths)} · <span className="text-emerald-400 font-semibold">+{brl0(best.netGain)}</span> de juros
        </div>

        <div className="mt-5">
          <div className="flex h-[9px] rounded-full overflow-hidden bg-white/[0.06]">
            <div className="bg-slate-600" style={{ width: bar.invested }} />
            <div className="bg-gradient-to-r from-emerald-400 to-emerald-300" style={{ width: bar.gain }} />
          </div>
          <div className="flex justify-between mt-2.5 text-[11.5px] gap-3 flex-wrap">
            <span className="text-slate-400">
              <span className="inline-block w-[7px] h-[7px] rounded-sm bg-slate-600 mr-1.5" />
              Você aportou {brl0(best.invested)}
            </span>
            <span className="text-emerald-300">
              <span className="inline-block w-[7px] h-[7px] rounded-sm bg-emerald-400 mr-1.5" />
              +{pct(best.netReturn)} sobre o investido
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-w-[200px] sm:max-w-[240px] flex flex-col gap-2.5">
        <div className="px-4 py-3.5 rounded-xl bg-deep/60 border border-white/[0.07]">
          <div className="text-[10.5px] tracking-[0.13em] text-slate-500 font-bold mb-1.5">RENT. LÍQUIDA</div>
          <div className="font-mono text-[22px] font-semibold text-sky-400">{pct(best.netReturn)}</div>
        </div>
        <div className="px-4 py-3.5 rounded-xl bg-deep/60 border border-white/[0.07]">
          <div className="text-[10.5px] tracking-[0.13em] text-slate-500 font-bold mb-1.5">A MAIS QUE A POUPANÇA</div>
          <div className="font-mono text-[22px] font-semibold text-emerald-400">
            {poupanca ? `+${brl0(best.netValue - poupanca.netValue)}` : '—'}
          </div>
        </div>
      </div>
    </section>
  );
}

function EvolutionSection({ selected, periodMonths }: { selected: SelectedSeries[]; periodMonths: number }) {
  return (
    <section className="rounded-[18px] bg-card border border-white/[0.07] p-[22px]">
      <div className="flex justify-between items-center gap-3.5 flex-wrap mb-1.5">
        <div>
          <SectionTitle>EVOLUÇÃO DO PATRIMÔNIO LÍQUIDO</SectionTitle>
          <div className="text-xs text-slate-500 mt-1.5">
            Toque em até 3 instrumentos na lista abaixo para comparar as curvas
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selected.map(s => (
            <div
              key={s.result.id}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.07] text-xs font-semibold text-slate-200"
            >
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              {s.result.label}
            </div>
          ))}
        </div>
      </div>
      <EvolutionChart selected={selected} months={periodMonths} />
    </section>
  );
}

function CompareSection({ selected }: { selected: SelectedSeries[] }) {
  return (
    <section className="rounded-[18px] bg-card border border-white/[0.07] p-[22px]">
      <SectionTitle>COMPARATIVO LADO A LADO</SectionTitle>
      <div className="text-xs text-slate-500 mt-1 mb-[18px]">Do valor bruto ao que sobra na sua conta</div>

      <div className="flex gap-3.5 overflow-x-auto pb-1">
        <div className="flex-none flex flex-col gap-px pt-11">
          {COMPARE_ROWS.map(row => (
            <div key={row.label} className="h-10 flex items-center text-xs text-slate-400 whitespace-nowrap pr-2">
              {row.label}
            </div>
          ))}
        </div>
        {selected.map(s => (
          <div key={s.result.id} className="flex-1 min-w-[150px] rounded-xl bg-white/[0.02] border border-white/[0.07] overflow-hidden">
            <div
              className="px-3.5 py-2.5 border-b border-white/[0.06]"
              style={{ background: `linear-gradient(180deg, ${s.color}22, transparent)` }}
            >
              <div className="text-[13px] font-semibold text-white truncate">{s.result.label}</div>
              <div className="text-[10.5px] text-slate-400 mt-0.5 truncate">{s.result.sub}</div>
            </div>
            <div className="flex flex-col gap-px px-3.5">
              {COMPARE_ROWS.map(row => {
                const cell = row.cell(s.result);
                return (
                  <div
                    key={row.label}
                    className={`h-10 flex items-center font-mono text-[12.5px] whitespace-nowrap border-b border-white/[0.04] last:border-0 ${cell.tone}`}
                  >
                    {cell.value}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface InstrumentsProps {
  results: InstrumentResult[];
  periodMonths: number;
  selected: SelectedSeries[];
  expanded: string | null;
  onExpand: (id: string | null) => void;
  onCompare: (id: string) => void;
}

function InstrumentsSection({ results, periodMonths, selected, expanded, onExpand, onCompare }: InstrumentsProps) {
  const best = results[0];
  const colorOf = (id: string) => selected.find(s => s.result.id === id)?.color ?? null;
  return (
    <section>
      <div className="flex justify-between items-end gap-3 flex-wrap mb-3.5">
        <div>
          <SectionTitle>TODOS OS INSTRUMENTOS</SectionTitle>
          <div className="text-xs text-slate-500 mt-1.5">
            Ordenados pelo valor que você resgata, já com IR e custos descontados
          </div>
        </div>
        <div className="font-mono text-[11.5px] text-slate-500">{formatPeriod(periodMonths)}</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {results.map((r, idx) => (
          <InstrumentCard
            key={r.id}
            result={r}
            rank={idx + 1}
            isTop={idx === 0}
            maxNet={best.netValue}
            months={periodMonths}
            best={best}
            selectedColor={colorOf(r.id)}
            expanded={expanded === r.id}
            onToggle={() => onExpand(expanded === r.id ? null : r.id)}
            onCompare={() => onCompare(r.id)}
          />
        ))}
      </div>
    </section>
  );
}

function CalcFooter() {
  return (
    <footer className="max-w-[1360px] mx-auto px-4 md:px-6 pt-8 pb-12">
      <div className="rounded-2xl bg-card border border-white/[0.06] p-5">
        <div className="mb-2.5"><SectionTitle>COMO CALCULAMOS</SectionTitle></div>
        <p className="text-xs leading-[1.75] text-slate-500">
          Os cálculos usam as taxas de mercado exibidas em <span className="text-slate-400">Parâmetros hoje</span>, mantidas constantes ao
          longo do período. O IR segue a tabela regressiva: 22,5% até 6 meses, 20% até 12 meses, 17,5% até 24 meses e 15% acima disso.
          Custódia da B3 nos títulos do Tesouro Direto: 0,20% a.a. Fundo DI considerado a 98% do CDI com taxa de administração de 0,25% a.a.
          LCI e LCA a 85% do CDI. Poupança a 0,5% ao mês mais TR, com Selic acima de 8,5% a.a. Ações e FIIs exibem apenas a projeção pelo DY
          atual; variação de preço não entra na conta. Rentabilidade passada e taxas atuais não garantem resultado futuro.
        </p>
      </div>
      <div className="flex justify-between items-center gap-4 flex-wrap mt-5 text-[11.5px] text-slate-500">
        <span>VÉRTICE INVEST · Calculadora de Investimentos</span>
        <span className="font-mono">Taxas atualizadas em {new Date().toLocaleDateString('pt-BR')}</span>
      </div>
    </footer>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export const Calculator: React.FC = () => {
  const [mode, setMode] = useState<CalcMode>('simular');
  // A página abre zerada: quem chega aqui preenche os próprios números, e um valor
  // de exemplo já calculado passaria por resultado do usuário.
  const [initial, setInitial] = useState(0);
  const [monthly, setMonthly] = useState(0);
  const [goal, setGoal] = useState(0);
  const [periodMonths, setPeriodMonths] = useState(60);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [selectedFii, setSelectedFii] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>(['cdb', 'poupanca']);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scenarios, persistScenarios] = useSavedScenarios();

  const { data: macro, isLoading: macroLoading } = useQuery({
    queryKey: ['macroData'],
    queryFn: researchService.getMacroData,
    staleTime: 15 * 60 * 1000,
  });

  const stockQuote = useQuote(selectedStock);
  const fiiQuote = useQuote(selectedFii);
  const stockDy = dyOf(stockQuote);
  const fiiDy = dyOf(fiiQuote);

  const isMeta = mode === 'meta';

  /** Cada aba tem a sua própria lista salva. */
  const visibleScenarios = useMemo(() => scenarios.filter(s => s.mode === mode), [scenarios, mode]);

  const need = useMemo(
    () => (isMeta && goal > 0 ? neededMonthly(goal, initial, periodMonths, macro) : null),
    [isMeta, goal, initial, periodMonths, macro],
  );

  /** No modo meta o aporte não é escolhido: é o que a bisseção encontrou. */
  const effectiveMonthly = isMeta ? (need?.value ?? 0) : monthly;

  const results = useMemo(
    () => calcAll(initial, effectiveMonthly, periodMonths, macro, stockDy, fiiDy, selectedStock, selectedFii),
    [initial, effectiveMonthly, periodMonths, macro, stockDy, fiiDy, selectedStock, selectedFii],
  );

  const best = results[0];
  /**
   * Na aba da meta, sem meta não há o que mostrar: o resultado seria o do aporte
   * inicial sozinho, que não responde à pergunta da aba.
   */
  const shown = best && (!isMeta || goal > 0) ? best : null;

  const selected = useMemo(
    () =>
      compare
        .map(id => results.find(r => r.id === id))
        .filter((r): r is InstrumentResult => !!r)
        .map((result, i) => ({ result, color: SERIES_COLORS[i % SERIES_COLORS.length] })),
    [compare, results],
  );

  const saveScenario = () => {
    if (!shown) return;
    const entry = buildScenario({
      mode, initial, monthly: effectiveMonthly, months: periodMonths, goal, selected, stock: selectedStock, fii: selectedFii, best: shown,
    });
    persistScenarios(addScenario(scenarios, entry));
  };

  const loadScenario = (s: Scenario) => {
    setMode(s.mode);
    setInitial(s.initial);
    setPeriodMonths(s.months);
    if (s.mode === 'meta') setGoal(s.goal ?? 0);
    else setMonthly(s.monthly);
    // Ativos primeiro: os ids de ação/FII em `compare` só resolvem depois que a cotação do ticker chega.
    setSelectedStock(s.stock ?? null);
    setSelectedFii(s.fii ?? null);
    if (s.compare?.length) setCompare(s.compare);
  };

  return (
    <div className="min-h-screen bg-deep text-white pb-[calc(4rem+env(safe-area-inset-bottom))] xl:pb-0">
      <Header />

      <div
        style={{
          backgroundImage:
            'radial-gradient(1200px 600px at 15% -10%, rgba(56,189,248,0.10), transparent 60%), radial-gradient(900px 500px at 95% 0%, rgba(52,211,153,0.07), transparent 55%)',
        }}
      >
        <main id="main-content" tabIndex={-1} className="max-w-[1360px] mx-auto px-4 md:px-6 pt-8 pb-3">

          {/* ── Cabeçalho da página ── */}
          <PageHeading isMeta={isMeta} onMode={setMode} />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)] gap-[18px] items-start">

            {/* ══ COLUNA ESQUERDA ══ */}
            <div className="flex flex-col gap-[18px] min-w-0">
              <ConfigSection
                isMeta={isMeta}
                initial={initial} setInitial={setInitial}
                monthly={monthly} setMonthly={setMonthly}
                goal={goal} setGoal={setGoal}
                periodMonths={periodMonths} setPeriodMonths={setPeriodMonths}
                totalInvested={initial + effectiveMonthly * periodMonths}
                need={need}
              />
              <ParamsSection macroLoading={macroLoading} ratesAvailable={macroRates(macro) !== null} params={marketParams(macro)} />
              <AssetSection
                selectedStock={selectedStock} setSelectedStock={setSelectedStock} stockNote={dyNote(selectedStock, stockQuote, stockDy)}
                selectedFii={selectedFii} setSelectedFii={setSelectedFii} fiiNote={dyNote(selectedFii, fiiQuote, fiiDy)}
              />
              <ScenariosSection
                isMeta={isMeta}
                canSave={!!shown}
                onSave={saveScenario}
                list={visibleScenarios}
                onLoad={loadScenario}
                onRemove={(s) => persistScenarios(scenarios.filter(x => x !== s))}
              />
            </div>

            {/* ══ COLUNA DIREITA ══ */}
            <div className="min-w-0 flex flex-col gap-[18px]">
              {!shown ? (
                <section className="rounded-[20px] border border-white/[0.08] bg-card p-10 text-center">
                  <p className="text-sm text-slate-400">{emptyResultMessage(macroLoading, macroRates(macro) !== null, isMeta)}</p>
                </section>
              ) : (
                <>
                  <BestHighlight best={shown} periodMonths={periodMonths} poupanca={results.find(r => r.id === 'poupanca')} />
                  <EvolutionSection selected={selected} periodMonths={periodMonths} />
                  <CompareSection selected={selected} />
                  <InstrumentsSection
                    results={results}
                    periodMonths={periodMonths}
                    selected={selected}
                    expanded={expanded}
                    onExpand={setExpanded}
                    onCompare={(id) => setCompare(prev => toggleCompareList(prev, id))}
                  />
                </>
              )}
            </div>
          </div>
        </main>

        {/* ── Como calculamos ── */}
        <CalcFooter />
      </div>
    </div>
  );
};
