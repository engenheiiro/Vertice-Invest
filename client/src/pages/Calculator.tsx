
import React, { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Calculator as CalculatorIcon, TrendingUp, ChevronDown, Info, AlertCircle } from 'lucide-react';
import { Header } from '../components/dashboard/Header';
import { researchService } from '../services/research';
import { authService } from '../services/auth';

// ─── Listas curadas ───────────────────────────────────────────────────────────

const POPULAR_STOCKS = [
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

const POPULAR_FIIS = [
  { ticker: 'HGLG11', name: 'CSHG Logística' },
  { ticker: 'XPML11', name: 'XP Malls' },
  { ticker: 'KNRI11', name: 'Kinea Renda Imob.' },
  { ticker: 'MXRF11', name: 'Maxi Renda' },
  { ticker: 'HGRE11', name: 'CSHG Real Estate' },
  { ticker: 'BCFF11', name: 'BTG Fundo de Fundos' },
  { ticker: 'XPLG11', name: 'XP Log' },
  { ticker: 'BTLG11', name: 'BTG Logístico' },
  { ticker: 'VILG11', name: 'Vinci Logística' },
  { ticker: 'PVBI11', name: 'VBI Prime Properties' },
  { ticker: 'VRTA11', name: 'Votorantim Rec. Imob.' },
  { ticker: 'CPTS11', name: 'Capitânia Securities' },
  { ticker: 'MCCI11', name: 'Mauá Crédito Imob.' },
  { ticker: 'IRDM11', name: 'Iridium Recebíveis' },
  { ticker: 'VGIP11', name: 'Valora Hedge Fund' },
];

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface InstrumentResult {
  id: string;
  label: string;
  grossValue: number;
  costs: number;
  ir: number;
  netValue: number;
  grossReturn: number;
  netReturn: number;
  netGain: number;
  taxExempt: boolean;
  isAsset?: boolean;
  color: string;
}

// ─── Funções de cálculo ───────────────────────────────────────────────────────

function fv(rate: number, n: number, pv: number, pmt: number): number {
  if (rate === 0 || !isFinite(rate)) return pv + pmt * n;
  return pv * Math.pow(1 + rate, n) + (pmt * (Math.pow(1 + rate, n) - 1)) / rate;
}

function irRate(months: number): number {
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
  grossRateAnnual: number,
  netRateAnnual: number,
  initial: number,
  monthly: number,
  months: number,
  exempt: boolean,
  color: string,
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

  return { id, label, grossValue, costs, ir, netValue, grossReturn, netReturn, netGain, taxExempt: exempt, isAsset, color };
}

function calcAll(
  initial: number,
  monthly: number,
  months: number,
  macro: Record<string, unknown> | null,
  stockDy: number | null,
  fiiDy: number | null,
  selectedStock: string | null,
  selectedFii: string | null,
): InstrumentResult[] {
  if (months === 0 || (initial <= 0 && monthly <= 0)) return [];

  const selic = (macro?.selic as { value?: number })?.value ?? 14.40;
  const cdi = (macro?.cdi as { value?: number })?.value ?? 14.40;
  const ipca = (macro?.ipca as { value?: number })?.value ?? 4.62;
  const ntnbLong = (macro?.ntnbLong as { value?: number })?.value ?? 6.50;

  const bonds = (macro?.bonds as Array<{ type?: string; rate?: number; annualRate?: number }>) ?? [];
  const prefBond = bonds.find(b => {
    const t = (b.type ?? '').toLowerCase();
    return t.includes('prefixado') && !t.includes('juros');
  });
  const prefixado = prefBond?.rate ?? prefBond?.annualRate ?? Math.max(selic - 0.5, 8);

  const trMonthly = 0.1708;
  const poupancaMonthlyPct = selic > 8.5 ? 0.5 + trMonthly : (selic * 0.70) / 12;
  const poupancaAnnual = (Math.pow(1 + poupancaMonthlyPct / 100, 12) - 1) * 100;
  const ipcaPlus = ((1 + ipca / 100) * (1 + ntnbLong / 100) - 1) * 100;

  const CUSTODY = 0.20;
  const FUNDO_DI_ADMIN = 0.25;
  const LCI_PCT = 0.85;
  const FUNDO_CDI_PCT = 0.9817;

  const results: InstrumentResult[] = [
    calcInstrument('cdb', 'CDB', cdi, cdi, initial, monthly, months, false, 'bg-sky-500'),
    calcInstrument('tesouro-selic', 'Tesouro Selic', selic, selic - CUSTODY, initial, monthly, months, false, 'bg-sky-500'),
    calcInstrument('lci-lca', 'LCI e LCA', cdi * LCI_PCT, cdi * LCI_PCT, initial, monthly, months, true, 'bg-sky-500'),
    calcInstrument('fundo-di', 'Fundo DI', cdi * FUNDO_CDI_PCT, cdi * FUNDO_CDI_PCT - FUNDO_DI_ADMIN, initial, monthly, months, false, 'bg-sky-500'),
    calcInstrument('prefixado', 'Tesouro Prefixado', prefixado, prefixado - CUSTODY, initial, monthly, months, false, 'bg-sky-500'),
    calcInstrument('poupanca', 'Poupança', poupancaAnnual, poupancaAnnual, initial, monthly, months, true, 'bg-slate-500'),
    calcInstrument('ipca-plus', 'Tesouro IPCA+', ipcaPlus, ipcaPlus - CUSTODY, initial, monthly, months, false, 'bg-sky-500'),
  ];

  if (selectedStock && stockDy != null && stockDy > 0) {
    const stockName = POPULAR_STOCKS.find(s => s.ticker === selectedStock)?.name ?? selectedStock;
    results.push(
      calcInstrument(`stock-${selectedStock}`, `${selectedStock} · ${stockName}`, stockDy, stockDy, initial, monthly, months, true, 'bg-purple-500', true),
    );
  }

  if (selectedFii && fiiDy != null && fiiDy > 0) {
    const fiiName = POPULAR_FIIS.find(f => f.ticker === selectedFii)?.name ?? selectedFii;
    results.push(
      calcInstrument(`fii-${selectedFii}`, `${selectedFii} · ${fiiName}`, fiiDy, fiiDy, initial, monthly, months, true, 'bg-purple-500', true),
    );
  }

  return results.sort((a, b) => b.netValue - a.netValue);
}

// ─── Formatação ───────────────────────────────────────────────────────────────

const brl = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

const pct = (n: number) =>
  `${n.toFixed(2).replace('.', ',')}%`;

function formatPeriod(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} ${m === 1 ? 'mês' : 'meses'}`;
  if (m === 0) return `${y} ${y === 1 ? 'ano' : 'anos'}`;
  return `${y} ${y === 1 ? 'ano' : 'anos'} e ${m} ${m === 1 ? 'mês' : 'meses'}`;
}

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function CurrencyInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [digits, setDigits] = useState('');
  const [focused, setFocused] = useState(false);

  const handleFocus = () => {
    setFocused(true);
    setDigits(value > 0 ? (value * 100).toFixed(0) : '');
  };

  const handleBlur = () => {
    setFocused(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = e.target.value.replace(/\D/g, '');
    setDigits(d);
    onChange(Number(d) / 100);
  };

  // Real-time BRL mask: always show formatted currency, even while typing
  const displayValue = focused
    ? (digits.length > 0
        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(digits) / 100)
        : '')
    : (value > 0
        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
        : '');

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="R$ 0,00"
        className="w-full bg-[#0F131E] border border-white/10 focus:border-emerald-500/50 focus:outline-none rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 transition-colors"
      />
    </div>
  );
}

function PeriodInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const displayYears = Math.floor(value / 12);
  const displayMonths = value % 12;

  const setYears = (y: number) => onChange(Math.max(0, y) * 12 + displayMonths);
  const setMonths = (m: number) => {
    const clamped = Math.max(0, Math.min(11, m));
    // If years would be 0 and months would be 0, set to 1 month minimum
    if (displayYears === 0 && clamped === 0) return;
    onChange(displayYears * 12 + clamped);
  };

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">Período da aplicação</label>
      <div className="flex items-center gap-3">
        {/* Anos */}
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setYears(displayYears - 1)}
              disabled={displayYears === 0}
              className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 flex items-center justify-center text-base font-bold transition-colors"
            >−</button>
            <span className="flex-1 text-center text-white font-bold text-base">{displayYears}</span>
            <button
              onClick={() => setYears(displayYears + 1)}
              disabled={displayYears >= 40}
              className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 flex items-center justify-center text-base font-bold transition-colors"
            >+</button>
          </div>
          <p className="text-center text-[10px] text-slate-500 mt-1">anos</p>
        </div>

        <span className="text-slate-600 text-xs pb-4">·</span>

        {/* Meses */}
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setMonths(displayMonths - 1)}
              disabled={displayYears === 0 && displayMonths <= 1}
              className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 flex items-center justify-center text-base font-bold transition-colors"
            >−</button>
            <span className="flex-1 text-center text-white font-bold text-base">{displayMonths}</span>
            <button
              onClick={() => setMonths(displayMonths + 1)}
              disabled={displayMonths >= 11}
              className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 flex items-center justify-center text-base font-bold transition-colors"
            >+</button>
          </div>
          <p className="text-center text-[10px] text-slate-500 mt-1">meses</p>
        </div>
      </div>
    </div>
  );
}

function AssetSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { ticker: string; name: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      <div className="relative">
        <select
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          className="w-full appearance-none bg-[#0F131E] border border-white/10 focus:border-purple-500/50 focus:outline-none rounded-lg px-3 py-2.5 text-sm text-white transition-colors pr-8"
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

function MacroChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-mono font-semibold text-slate-300">{value}</span>
    </div>
  );
}

// Custom tooltip para o PieChart
function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { color: string } }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0F131E] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p style={{ color: payload[0].payload.color }} className="font-semibold mb-0.5">{payload[0].name}</p>
      <p className="text-white font-mono font-bold">{brl(payload[0].value)}</p>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export const Calculator: React.FC = () => {
  const [initial, setInitial] = useState(0);
  const [monthly, setMonthly] = useState(0);
  const [periodMonths, setPeriodMonths] = useState(60); // 5 anos
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [selectedFii, setSelectedFii] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  const { data: macro, isLoading: macroLoading } = useQuery({
    queryKey: ['macroData'],
    queryFn: researchService.getMacroData,
    staleTime: 15 * 60 * 1000,
  });

  const { data: stockQuote } = useQuery({
    queryKey: ['quote', selectedStock],
    queryFn: async () => {
      const r = await authService.api(`/api/market/quote?ticker=${selectedStock}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!selectedStock,
    staleTime: 5 * 60 * 1000,
  });

  const { data: fiiQuote } = useQuery({
    queryKey: ['quote', selectedFii],
    queryFn: async () => {
      const r = await authService.api(`/api/market/quote?ticker=${selectedFii}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!selectedFii,
    staleTime: 5 * 60 * 1000,
  });

  const stockDy: number | null = stockQuote?.dy > 0 ? stockQuote.dy : null;
  const fiiDy: number | null = fiiQuote?.dy > 0 ? fiiQuote.dy : null;

  const results = useMemo(
    () => calcAll(initial, monthly, periodMonths, macro, stockDy, fiiDy, selectedStock, selectedFii),
    [initial, monthly, periodMonths, macro, stockDy, fiiDy, selectedStock, selectedFii],
  );

  const best = results[0];
  const maxNet = best?.netValue ?? 0;
  const totalInvested = initial + monthly * periodMonths;

  // Parâmetros para exibição
  const selic = (macro?.selic as { value?: number })?.value;
  const cdi = (macro?.cdi as { value?: number })?.value;
  const ipca = (macro?.ipca as { value?: number })?.value;
  const ntnbLong = (macro?.ntnbLong as { value?: number })?.value;
  const bonds = (macro?.bonds as Array<{ type?: string; rate?: number; annualRate?: number }>) ?? [];
  const prefBond = bonds.find(b => {
    const t = (b.type ?? '').toLowerCase();
    return t.includes('prefixado') && !t.includes('juros');
  });
  const prefixado = prefBond?.rate ?? prefBond?.annualRate;

  // Dados do gráfico de pizza (melhor instrumento)
  const pieData = best && totalInvested > 0 ? [
    { name: 'Valor investido', value: totalInvested, color: '#475569' },
    { name: 'Juros compostos', value: Math.max(0, best.netGain), color: '#10b981' },
  ] : [];

  return (
    <div className="min-h-screen bg-[#080C14] text-white">
      <Header />

      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-8">

        {/* Título */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 bg-emerald-600/20 border border-emerald-600/30 rounded-lg flex items-center justify-center">
            <CalculatorIcon size={16} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Calculadora de Investimentos</h1>
            <p className="text-xs text-slate-500">Taxas atualizadas automaticamente com dados de mercado de hoje</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

          {/* ── Painel esquerdo: configuração ── */}
          <div className="space-y-5">

            <div className="bg-[#0B101A] border border-white/5 rounded-xl p-5 space-y-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Configuração</h2>

              <CurrencyInput label="Investimento inicial" value={initial} onChange={setInitial} />
              <CurrencyInput label="Aportes mensais" value={monthly} onChange={setMonthly} />
              <PeriodInput value={periodMonths} onChange={setPeriodMonths} />

              <div className="bg-white/3 rounded-lg p-3 mt-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Total investido</span>
                  <span className="text-white font-semibold">{brl(totalInvested)}</span>
                </div>
              </div>
            </div>

            {/* Parâmetros de mercado */}
            <div className="bg-[#0B101A] border border-white/5 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Parâmetros hoje</h2>
                {macroLoading && <div className="w-3 h-3 rounded-full border border-slate-600 border-t-emerald-400 animate-spin" />}
              </div>

              {macroLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-6 bg-white/5 rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                <div>
                  {cdi != null && <MacroChip label="CDI (a.a.)" value={pct(cdi)} />}
                  {selic != null && <MacroChip label="Selic efetiva (a.a.)" value={pct(selic)} />}
                  {ipca != null && <MacroChip label="IPCA (a.a.)" value={pct(ipca)} />}
                  {ntnbLong != null && <MacroChip label="Juro real IPCA+ (a.a.)" value={pct(ntnbLong)} />}
                  {prefixado != null && <MacroChip label="Tesouro Prefixado (a.a.)" value={pct(prefixado)} />}
                  <MacroChip label="TR (a.m.) · Poupança" value="0,1708%" />
                </div>
              )}
            </div>

            {/* Comparar com ativos */}
            <div className="bg-[#0B101A] border border-white/5 rounded-xl p-5 space-y-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Comparar com ativo</h2>
              <AssetSelect
                label="Ação (mais queridas)"
                options={POPULAR_STOCKS}
                value={selectedStock}
                onChange={setSelectedStock}
              />
              {selectedStock && stockDy != null && (
                <p className="text-[11px] text-purple-400">DY atual: {pct(stockDy)}</p>
              )}
              {selectedStock && stockQuote !== undefined && !stockDy && (
                <p className="text-[11px] text-slate-500">DY não disponível para este ativo</p>
              )}
              {selectedStock && stockQuote === undefined && (
                <p className="text-[11px] text-slate-500">Carregando DY…</p>
              )}

              <AssetSelect
                label="FII (mais queridos)"
                options={POPULAR_FIIS}
                value={selectedFii}
                onChange={setSelectedFii}
              />
              {selectedFii && fiiDy != null && (
                <p className="text-[11px] text-purple-400">DY atual: {pct(fiiDy)}</p>
              )}
              {selectedFii && fiiQuote !== undefined && !fiiDy && (
                <p className="text-[11px] text-slate-500">DY não disponível para este ativo</p>
              )}
              {selectedFii && fiiQuote === undefined && (
                <p className="text-[11px] text-slate-500">Carregando DY…</p>
              )}

              {(selectedStock || selectedFii) && (
                <div className="flex gap-2 bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
                  <AlertCircle size={12} className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[10px] text-amber-300/80 leading-relaxed">
                    Projeção considera apenas o DY atual, sem variação de preço. Rendimento passado não garante retorno futuro.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Painel direito: ranking visual ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Ranking */}
            <div className="bg-[#0B101A] border border-white/5 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Melhores opções · Valor líquido de resgate</h2>
                <span className="text-[10px] text-slate-600">{formatPeriod(periodMonths)}</span>
              </div>

              {results.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-600 text-sm">
                  Preencha o valor inicial ou aporte mensal para simular
                </div>
              ) : (
                <div className="space-y-2.5">
                  {results.map((r, idx) => {
                    const barWidth = maxNet > 0 ? (r.netValue / maxNet) * 100 : 0;
                    const isTop = idx === 0;
                    return (
                      <div key={r.id} className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-slate-600 w-4 text-right shrink-0">{idx + 1}</span>
                        <div className="w-40 shrink-0 flex items-center gap-1.5">
                          <span className={`text-xs font-medium leading-tight ${r.isAsset ? 'text-purple-300' : 'text-slate-300'}`}>
                            {r.label}
                          </span>
                          {r.taxExempt && (
                            <span className="text-[8px] font-bold text-emerald-600 bg-emerald-900/30 border border-emerald-800/40 rounded px-1 py-0.5 shrink-0 whitespace-nowrap">IR</span>
                          )}
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 bg-white/5 rounded-full h-5 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                r.isAsset
                                  ? 'bg-purple-500'
                                  : isTop
                                  ? 'bg-sky-500'
                                  : idx < 4
                                  ? 'bg-sky-600/80'
                                  : 'bg-slate-600'
                              }`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold font-mono shrink-0 w-28 text-right ${isTop ? 'text-emerald-400' : 'text-slate-300'}`}>
                            {brl(r.netValue)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {results.length > 0 && (
                <button
                  onClick={() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="mt-5 w-full flex items-center justify-center gap-2 py-2 border border-white/10 hover:border-white/20 rounded-lg text-xs text-slate-400 hover:text-white transition-colors"
                >
                  <TrendingUp size={12} />
                  Ver simulação completa
                </button>
              )}
            </div>

            {/* Destaques + Gráfico */}
            {results.length > 0 && best && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* Gráfico de pizza */}
                <div className="bg-[#0B101A] border border-white/5 rounded-xl p-4">
                  <p className="text-[10px] text-slate-500 mb-3 font-semibold uppercase tracking-wider">Composição do resultado · {best.label}</p>
                  <div className="flex items-center gap-4">
                    <div className="w-28 h-28 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={28}
                            outerRadius={52}
                            paddingAngle={2}
                            dataKey="value"
                            strokeWidth={0}
                          >
                            {pieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2.5 flex-1 min-w-0">
                      {pieData.map(d => (
                        <div key={d.name}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                            <span className="text-[10px] text-slate-500 truncate">{d.name}</span>
                          </div>
                          <p className="text-sm font-bold font-mono text-white pl-3.5">{brl(d.value)}</p>
                        </div>
                      ))}
                      {totalInvested > 0 && best.netGain > 0 && (
                        <p className="text-[10px] text-emerald-500 pl-3.5 font-semibold">
                          +{pct((best.netGain / totalInvested) * 100)} sobre o investido
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cards de destaque */}
                <div className="space-y-4">
                  <div className="bg-[#0B101A] border border-white/5 rounded-xl p-4">
                    <p className="text-[10px] text-slate-500 mb-1">Melhor opção</p>
                    <p className="text-sm font-bold text-emerald-400">{best.label}</p>
                    <p className="text-lg font-bold text-white mt-1">{brl(best.netValue)}</p>
                  </div>
                  <div className="bg-[#0B101A] border border-white/5 rounded-xl p-4">
                    <p className="text-[10px] text-slate-500 mb-1">Total investido</p>
                    <p className="text-lg font-bold text-white">{brl(totalInvested)}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {monthly > 0 ? `${brl(initial)} + ${brl(monthly)}/mês` : 'Aporte único'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Tabela de simulação detalhada ── */}
        {results.length > 0 && (
          <div ref={tableRef} className="mt-8 bg-[#0B101A] border border-white/5 rounded-xl overflow-hidden">
            <div className="p-5 border-b border-white/5">
              <h2 className="text-sm font-bold text-white">Simulação do investimento</h2>
              <div className="flex flex-wrap gap-6 mt-3 text-xs">
                <span><span className="text-slate-500">Valor inicial: </span><span className="text-sky-400 font-semibold">{brl(initial)}</span></span>
                <span><span className="text-slate-500">Aportes mensais: </span><span className="text-sky-400 font-semibold">{brl(monthly)}</span></span>
                <span><span className="text-slate-500">Período: </span><span className="text-sky-400 font-semibold">{formatPeriod(periodMonths)}</span></span>
                <span><span className="text-slate-500">Total investido: </span><span className="text-sky-400 font-semibold">{brl(totalInvested)}</span></span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 bg-white/2">
                    <th className="text-left py-3 px-4 text-slate-500 font-semibold w-48">Instrumento</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-semibold">Valor bruto</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-semibold">Rent. bruta</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-semibold">Custos</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-semibold">IR pago</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-semibold">Valor líquido</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-semibold">Rent. líquida</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-semibold">Ganho líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, idx) => (
                    <tr
                      key={r.id}
                      className={`border-b border-white/5 transition-colors hover:bg-white/3 ${idx === 0 ? 'bg-emerald-900/10' : ''}`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {idx === 0 && <span className="text-[9px] bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded px-1 py-0.5 font-bold shrink-0">TOP</span>}
                          <span className={`font-medium ${r.isAsset ? 'text-purple-300' : 'text-slate-200'}`}>{r.label}</span>
                          {r.taxExempt && (
                            <span className="text-[8px] font-bold text-emerald-600 bg-emerald-900/30 border border-emerald-800/40 rounded px-1 py-0.5 whitespace-nowrap">IR</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300 font-mono">{brl(r.grossValue)}</td>
                      <td className="py-3 px-4 text-right text-slate-400 font-mono">{pct(r.grossReturn)}</td>
                      <td className="py-3 px-4 text-right text-slate-400 font-mono">{r.costs > 0.01 ? brl(r.costs) : '—'}</td>
                      <td className="py-3 px-4 text-right text-slate-400 font-mono">{r.ir > 0.01 ? brl(r.ir) : '—'}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-white">{brl(r.netValue)}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300">{pct(r.netReturn)}</td>
                      <td className={`py-3 px-4 text-right font-mono font-bold ${idx === 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                        {brl(r.netGain)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-white/5">
              <div className="flex items-start gap-2">
                <Info size={11} className="text-slate-600 mt-0.5 shrink-0" />
                <p className="text-[10px] text-slate-600 leading-relaxed">
                  Os cálculos consideram as taxas de mercado atuais exibidas nos parâmetros e são baseados em taxas constantes ao longo do período.
                  IR segue a tabela regressiva: 22,5% até 6 meses, 20% até 12 meses, 17,5% até 24 meses e 15% acima.
                  Custódia B3 (Tesouro Direto): 0,20% a.a. Taxa de administração Fundo DI: 0,25% a.a.
                  Ações e FIIs exibem apenas projeção pelo DY atual; variação de preço não é considerada.
                  Badge <span className="text-emerald-600 font-bold">IR</span> indica isenção de Imposto de Renda para pessoa física.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
