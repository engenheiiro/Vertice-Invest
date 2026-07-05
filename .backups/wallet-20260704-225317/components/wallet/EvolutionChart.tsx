
import React, { useMemo, useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { formatCurrency as fmtCurrency, formatPercent } from '../../utils/format';
import { buildEvolutionChartData, summarizeEvolutionWindow, type ChartGranularity, type ChartWindow } from '../../utils/evolutionChartData';

// Custom Tick para exibir o ponto pulsante no dia LIVE
const CustomXAxisTick = (props: any) => {
    const { x, y, payload, data } = props;

    // Encontra o item correspondente ao tick atual
    const item = data && data[payload.index];
    const isLive = item && item.isLive;

    return (
        <g transform={`translate(${x},${y})`}>
            <text
                x={0}
                y={0}
                dy={12}
                textAnchor="middle"
                fill="#64748b"
                fontSize={10}
                fontWeight={500}
            >
                {payload.value}
            </text>
            {isLive && (
                // Ponto Pulsante Vermelho
                <g>
                    <circle cx={14} cy={8} r={3} fill="#ef4444" className="animate-ping opacity-75" />
                    <circle cx={14} cy={8} r={2} fill="#ef4444" />
                </g>
            )}
        </g>
    );
};

// Janelas disponíveis por granularidade.
const WINDOW_OPTIONS: Record<ChartGranularity, ChartWindow[]> = {
    DAILY: ['7D', '30D', '90D'],
    MONTHLY: ['6M', '12M', 'ALL'],
};

export const EvolutionChart = React.memo(() => {
    const { kpis, history, isPrivacyMode } = useWallet();
    const [granularity, setGranularity] = useState<ChartGranularity>('MONTHLY');
    const [range, setRange] = useState<ChartWindow>('ALL');

    // Ao trocar de granularidade, reseta a janela para um default válido.
    const switchGranularity = (g: ChartGranularity) => {
        setGranularity(g);
        setRange(g === 'DAILY' ? '30D' : 'ALL');
    };

    const formatCurrency = (val: number) => {
        if (isPrivacyMode) return '••••••';
        if (val >= 1000000) return `R$ ${(val/1000000).toFixed(1)}M`;
        if (val >= 1000) return `R$ ${(val/1000).toFixed(0)}k`;
        return `R$ ${val.toFixed(0)}`;
    };

    const formatTooltipCurrency = (val: number) => fmtCurrency(val, 'BRL', { privacy: isPrivacyMode });

    // Moeda com sinal explícito (+) em positivos; Intl já prefixa o "-" em negativos.
    const formatSignedCurrency = (val: number) => {
        const formatted = fmtCurrency(val, 'BRL', { privacy: isPrivacyMode });
        return !isPrivacyMode && val > 0 ? `+${formatted}` : formatted;
    };

    const chartData = useMemo(
        () => buildEvolutionChartData({ history, kpis, granularity, window: range }),
        [history, kpis, granularity, range]
    );

    const summary = useMemo(() => summarizeEvolutionWindow(chartData), [chartData]);
    const hasLoss = useMemo(() => chartData.some((d) => d.lossBar > 0), [chartData]);
    const showSummary = summary.variationValue !== 0 || summary.variationPercent !== null;
    const summaryPositive = summary.variationValue >= 0;

    const barSize = chartData.length > 24 ? 12 : (chartData.length > 12 ? 20 : 35);

    if (kpis.totalEquity === 0 && chartData.length === 0) {
        return (
            <div className="bg-base border border-slate-800 rounded-2xl p-6 h-[420px] flex flex-col items-center justify-center text-center relative overflow-hidden group">
                <BarChart3 className="text-slate-700 mb-4" size={48} />
                <h3 className="text-slate-300 font-bold text-sm">Sem dados históricos</h3>
                <p className="text-slate-600 text-xs">O gráfico será gerado após o primeiro aporte.</p>
            </div>
        );
    }

    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-6 h-[420px] flex flex-col relative overflow-hidden shadow-sm hover:border-slate-700 transition-colors">

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 z-10 relative">
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-white">Evolução do Patrimônio</h3>
                        {showSummary && (
                            <span className={`text-xs font-bold font-mono ${summaryPositive ? 'text-emerald-400' : 'text-red-500'}`}>
                                {formatSignedCurrency(summary.variationValue)}
                                {summary.variationPercent !== null && (
                                    <span className="text-slate-500 font-sans"> · {formatPercent(summary.variationPercent, { privacy: isPrivacyMode, sign: true })}</span>
                                )}
                                <span className="text-slate-500 font-sans font-medium"> no período</span>
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-700"></span>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Valor Aplicado</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Resultado</p>
                        </div>
                        {hasLoss && (
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                <p className="text-[10px] text-slate-400 font-bold uppercase">Prejuízo</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Granularidade: Diário vs Mensal */}
                    <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                        {(['DAILY', 'MONTHLY'] as const).map((g) => (
                            <button
                                key={g}
                                onClick={() => switchGranularity(g)}
                                className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                    granularity === g
                                    ? 'bg-slate-700 text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {g === 'DAILY' ? 'Diário' : 'Mensal'}
                            </button>
                        ))}
                    </div>

                    {/* Janela — depende da granularidade */}
                    <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                        {WINDOW_OPTIONS[granularity].map((w) => (
                            <button
                                key={w}
                                onClick={() => setRange(w)}
                                className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                    range === w
                                    ? 'bg-slate-700 text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {w === 'ALL' ? 'Tudo' : w}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* (A1) descrição textual do gráfico para leitores de tela */}
            <div className="flex-1 w-full relative min-h-0 text-xs" role="img" aria-label="Gráfico de evolução patrimonial da carteira ao longo do tempo" aria-describedby="evolution-chart-desc">
                <p id="evolution-chart-desc" className="sr-only">
                    Gráfico de barras exibindo o patrimônio total da carteira. Alterne entre visão diária e mensal e use os controles de período para ajustar a janela exibida.
                    {showSummary && !isPrivacyMode && ` Resultado no período: ${formatSignedCurrency(summary.variationValue)}${summary.variationPercent !== null ? ` (${formatPercent(summary.variationPercent, { sign: true })})` : ''}.`}
                </p>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barGap={0}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />

                        <XAxis
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            minTickGap={10}
                            // Usa o componente customizado para desenhar o ponto live
                            tick={(props) => <CustomXAxisTick {...props} data={chartData} />}
                        />

                        <YAxis
                            tickFormatter={formatCurrency}
                            tick={{fill: '#64748b', fontSize: 10}}
                            axisLine={false}
                            tickLine={false}
                        />

                        <Tooltip
                            cursor={{ fill: '#1e293b', opacity: 0.3 }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    const displayLabel = data.fullDate || label;
                                    const variation = data.periodVariation || 0;
                                    const variationPct = data.periodVariationPercent;
                                    const isLive = data.isLive;
                                    // Zero é NEUTRO (cinza), não verde nem vermelho — dia sem
                                    // movimento (ex.: fim de semana de renda fixa) não é ganho
                                    // nem perda. Evita o "-R$ 0,00" vermelho por ruído de float.
                                    const variationColor = variation > 0 ? 'text-emerald-400' : variation < 0 ? 'text-red-500' : 'text-slate-400';
                                    const variationSign = variation > 0 ? '+' : '';

                                    return (
                                        <div className="bg-elevated border border-slate-700 rounded-xl p-3 shadow-2xl z-50 min-w-[210px]">
                                            <div className="flex justify-between items-center gap-4 border-b border-slate-800 pb-1.5 mb-2">
                                                <p className="text-slate-400 text-[10px] font-bold uppercase">{displayLabel}</p>
                                                {isLive && <span className="text-[9px] text-red-500 font-black animate-pulse flex items-center gap-1 whitespace-nowrap">● LIVE</span>}
                                            </div>

                                            <div className="space-y-1.5">
                                                <div className="flex justify-between items-center gap-6 text-xs">
                                                    <span className="text-emerald-600 font-bold">Aplicado</span>
                                                    <span className="text-slate-200 font-mono whitespace-nowrap">{formatTooltipCurrency(data.realInvested)}</span>
                                                </div>
                                                <div className="flex justify-between items-center gap-6 text-xs">
                                                    <span className="text-emerald-400 font-bold">Resultado</span>
                                                    <span className={`font-mono font-bold whitespace-nowrap ${data.realProfit >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
                                                        {data.realProfit >= 0 ? '+' : ''}{formatTooltipCurrency(data.realProfit)}
                                                    </span>
                                                </div>

                                                <div className="flex justify-between items-center gap-6 text-xs">
                                                    <span className="text-slate-400 font-bold whitespace-nowrap">Variação no período</span>
                                                    <span className={`font-mono font-bold whitespace-nowrap text-right ${variationColor}`}>
                                                        {variationSign}{formatTooltipCurrency(variation)}
                                                        {variationPct !== null && variationPct !== undefined && (
                                                            <span className="block text-[10px] font-sans opacity-80">{formatPercent(variationPct, { sign: true })}</span>
                                                        )}
                                                    </span>
                                                </div>

                                                <div className="border-t border-slate-800 pt-1.5 mt-1 flex justify-between items-center gap-6">
                                                    <span className="text-white font-bold text-xs uppercase whitespace-nowrap">Saldo Final</span>
                                                    <span className="text-white font-bold font-mono text-sm whitespace-nowrap">{formatTooltipCurrency(data.realEquity)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />

                        <Bar
                            dataKey="baseBar"
                            stackId="a"
                            fill="#047857" // Emerald 700
                            radius={[0, 0, 4, 4]}
                            maxBarSize={50}
                            barSize={barSize}
                            animationDuration={1000}
                        />

                        <Bar
                            dataKey="profitBar"
                            stackId="a"
                            fill="#34D399" // Emerald 400
                            radius={[4, 4, 0, 0]}
                            maxBarSize={50}
                            barSize={barSize}
                            animationDuration={1000}
                        />

                        {/* Capa vermelha translúcida: queda do patrimônio até o custo (aplicado) */}
                        <Bar
                            dataKey="lossBar"
                            stackId="a"
                            fill="#ef4444" // Red 500
                            fillOpacity={0.55}
                            radius={[4, 4, 0, 0]}
                            maxBarSize={50}
                            barSize={barSize}
                            animationDuration={1000}
                        />

                        <ReferenceLine y={0} stroke="#334155" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
});
