import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp } from 'lucide-react';
import {
    buildXAxisTicks, formatTooltipLabel, formatTooltipValue, formatXTick, formatYTick, seriesKeys, tickIntervalFor,
    type ChartPalette, type DisplayPoint, type PerformancePoint, type TimeRange, type ViewMode,
} from './performanceChartView';

const TOGGLE_BASE = 'px-3 min-h-[32px] inline-flex items-center justify-center text-[10px] font-bold rounded transition-all';
const toggleClass = (active: boolean) =>
    `${TOGGLE_BASE} ${active ? 'bg-base text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`;

const RANGES = ['1M', 'YTD', '12M', 'ALL'] as const;
const rangeLabel = (t: TimeRange) => (t === '1M' ? 'Mês' : t === 'ALL' ? 'Tudo' : t);

interface HeaderProps {
    timeRange: TimeRange;
    onTimeRange: (t: TimeRange) => void;
    viewMode: ViewMode;
    onViewMode: (v: ViewMode) => void;
    walletWin: boolean;
}

export function PerformanceChartHeader({ timeRange, onTimeRange, viewMode, onViewMode, walletWin }: HeaderProps) {
    return (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 z-10 relative">
            <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <TrendingUp size={16} className="text-blue-500" />
                    Performance Comparativa
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                    {viewMode === 'brl'
                        ? 'Evolução do patrimônio em R$ vs benchmarks'
                        : 'Rentabilidade TWRR · neutraliza aportes e resgates'}
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">

                {/* CONTROLE DE TEMPO */}
                <div className="bg-deep p-1 rounded-lg border border-slate-800 flex gap-1">
                    {RANGES.map((t) => (
                        <button key={t} onClick={() => onTimeRange(t)} className={toggleClass(timeRange === t)}>
                            {rangeLabel(t)}
                        </button>
                    ))}
                </div>

                <div className="w-px h-6 bg-slate-800 hidden sm:block"></div>

                {/* CONTROLE % vs R$ */}
                <div className="bg-deep p-1 rounded-lg border border-slate-800 flex gap-1">
                    <button onClick={() => onViewMode('pct')} className={toggleClass(viewMode === 'pct')} title="Rentabilidade percentual">
                        %
                    </button>
                    <button onClick={() => onViewMode('brl')} className={toggleClass(viewMode === 'brl')} title="Valor em R$">
                        R$
                    </button>
                </div>

                {walletWin && (
                    <span className="hidden md:inline-block text-[10px] font-bold text-emerald-500 bg-emerald-900/20 px-2 py-1 rounded border border-emerald-900/50">
                        Superando o Mercado 🚀
                    </span>
                )}
            </div>
        </div>
    );
}

const IBOV_ON = 'border-slate-500 bg-slate-700/40 text-slate-200 shadow-sm';
const IBOV_OFF = 'border-slate-800 bg-deep/80 text-slate-500 hover:border-slate-700 hover:text-slate-300';

/** Legenda; também concentra a opção do Ibovespa, que afeta a escala do gráfico. */
export function PerformanceLegend({ showIbov, onToggleIbov }: { showIbov: boolean; onToggleIbov: () => void }) {
    return (
        <div className="mb-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] font-bold text-slate-400 z-10">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-[3px] w-4 rounded-full bg-blue-500" aria-hidden="true" />
                Minha Carteira
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-4 border-t-2 border-dashed border-yellow-400" aria-hidden="true" />
                CDI
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-4 border-t-2 border-dotted border-fuchsia-500" aria-hidden="true" />
                Meta real · IPCA + 6% a.a.
            </span>
            <button
                type="button"
                onClick={onToggleIbov}
                aria-pressed={showIbov}
                aria-label={showIbov ? 'Ocultar Ibovespa' : 'Exibir Ibovespa'}
                className={`group inline-flex min-h-[30px] items-center gap-2 rounded-full border px-2.5 py-1 transition-all ${showIbov ? IBOV_ON : IBOV_OFF}`}
                title={showIbov ? 'Ocultar Ibovespa do gráfico' : 'Adicionar Ibovespa ao gráfico'}
            >
                <span className="w-4 border-t-2 border-dashed border-slate-400" aria-hidden="true" />
                Ibovespa
                <span
                    aria-hidden="true"
                    className={`relative h-4 w-7 rounded-full transition-colors ${showIbov ? 'bg-blue-500' : 'bg-slate-800'}`}
                >
                    <span
                        className={`absolute left-0 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${showIbov ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                    />
                </span>
            </button>
        </div>
    );
}

interface AreaChartProps {
    displayData: DisplayPoint[];
    filteredData: PerformancePoint[];
    timeRange: TimeRange;
    viewMode: ViewMode;
    showIbov: boolean;
    isPrivacyMode: boolean;
    palette: ChartPalette;
}

export function PerformanceAreaChart({ displayData, filteredData, timeRange, viewMode, showIbov, isPrivacyMode, palette }: AreaChartProps) {
    const keys = seriesKeys(viewMode);
    const ibovSuffix = showIbov ? ' e Ibovespa' : '';
    return (
        // (A1) descrição textual do gráfico para leitores de tela
        <div className="flex-1 w-full text-xs min-h-0" role="img" aria-label={`Gráfico de rentabilidade da carteira comparada aos benchmarks CDI, IPCA${ibovSuffix}`} aria-describedby="performance-chart-desc">
            <p id="performance-chart-desc" className="sr-only">
                Gráfico de área comparando a rentabilidade TWRR da carteira com CDI e a meta real de IPCA mais 6% ao ano{ibovSuffix}. Use os controles acima para alterar o período e alternar entre percentual e visão em reais.
            </p>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                        <linearGradient id="colorWallet" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.28} />
                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                        </linearGradient>
                    </defs>

                    <CartesianGrid strokeDasharray="3 3" stroke={palette.gridStroke} vertical={false} />

                    <XAxis
                        dataKey="date"
                        tick={{ fill: palette.axisTick, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        ticks={buildXAxisTicks(filteredData, timeRange)}
                        interval={tickIntervalFor(timeRange)}
                        tickFormatter={(val) => formatXTick(val, timeRange)}
                        minTickGap={10}
                    />

                    <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: palette.axisTick, fontSize: 10 }}
                        domain={['auto', 'auto']}
                        tickFormatter={(val) => formatYTick(val, viewMode, isPrivacyMode)}
                    />

                    <Tooltip
                        contentStyle={palette.tooltip}
                        itemStyle={{ fontWeight: 'bold' }}
                        labelStyle={{ color: '#94a3b8', marginBottom: '5px' }}
                        formatter={(value: number, name: string) => formatTooltipValue(value, name, viewMode, isPrivacyMode)}
                        labelFormatter={formatTooltipLabel}
                        cursor={{ stroke: palette.cursorStroke, strokeWidth: 1, strokeDasharray: '4 4' }}
                    />

                    <Area
                        type="monotone" dataKey={keys.ipca} name={keys.ipca}
                        stroke="#d946ef" strokeWidth={2} strokeDasharray="2 2" fill="transparent" activeDot={false}
                    />

                    {showIbov && (
                        <Area
                            type="monotone" dataKey={keys.ibov} name={keys.ibov}
                            stroke={palette.ibovStroke} strokeWidth={2} fill="transparent" strokeDasharray="6 3" activeDot={false}
                        />
                    )}

                    <Area
                        type="monotone" dataKey={keys.cdi} name={keys.cdi}
                        stroke="#fbbf24" strokeWidth={2} fill="transparent" strokeDasharray="4 4" activeDot={false}
                    />

                    <Area
                        type="monotone"
                        dataKey={keys.wallet}
                        name={keys.walletName}
                        stroke="#3B82F6"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorWallet)"
                        activeDot={{ r: 6, strokeWidth: 0, fill: '#60A5FA' }}
                    />

                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
