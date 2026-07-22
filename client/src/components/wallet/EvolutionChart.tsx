
import React, { useMemo, useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { useTheme } from '../../contexts/ThemeContext';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { formatCurrency as fmtCurrency, formatPercent } from '../../utils/format';
import { buildEvolutionChartData, buildEvolutionRenderData, summarizeEvolutionWindow, type ChartGranularity, type ChartWindow } from '../../utils/evolutionChartData';

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
    const { theme } = useTheme();
    // Grade/eixo/cursor theme-aware — mesma convenção do PerformanceChart. No claro
    // os tons escuros crus (#1e293b, #334155) ficavam pesados sobre o card branco.
    const gridStroke = theme === 'light' ? '#eef1f5' : '#232b36';
    const cursorStroke = theme === 'light' ? '#cbd5e1' : '#334155';
    // Bolha do ponto LIVE: contraste invertido ao tema (escura no claro, clara no escuro).
    const bubbleBg = theme === 'light' ? '#0f1b2d' : '#e9eef5';
    const bubbleText = theme === 'light' ? '#ffffff' : '#0d1117';
    const dotFill = theme === 'light' ? '#ffffff' : '#0B101A';
    const [granularity, setGranularity] = useState<ChartGranularity>('MONTHLY');
    const [range, setRange] = useState<ChartWindow>('ALL');

    // Ao trocar de granularidade, reseta a janela para um default válido.
    const switchGranularity = (g: ChartGranularity) => {
        setGranularity(g);
        setRange(g === 'DAILY' ? '30D' : 'ALL');
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
    // A âncora existe só na camada visual; cálculos e resumos continuam usando
    // chartData. Para séries com histórico, renderData === chartData.
    const renderData = useMemo(() => buildEvolutionRenderData(chartData), [chartData]);

    // Escala do eixo Y calculada a partir dos próprios dados (Patrimônio + Aplicado),
    // em vez de deixar o Recharts decidir. Dois motivos:
    //  1) Zoom: sem domain explícito o auto-scale às vezes inclui o zero (comum na
    //     janela Diária) e uma variação real de poucos R$ vira uma linha reta.
    //  2) Rótulos: geramos os ticks em passos "redondos" e derivamos as casas decimais
    //     do próprio passo — assim os labels ficam distintos em qualquer zoom (antes,
    //     numa faixa apertada, (val/1000).toFixed(0) colava tudo em "15k").
    const yScale = useMemo(() => {
        if (chartData.length === 0) return null;
        let min = Infinity, max = -Infinity;
        chartData.forEach((p) => {
            min = Math.min(min, p.realEquity, p.realInvested);
            max = Math.max(max, p.realEquity, p.realInvested);
        });
        if (!isFinite(min) || !isFinite(max)) return null;

        // Banda vertical do eixo — duas metas em tensão, resolvidas por um piso:
        //  • Movimento real pequeno (ex.: +0,16%) precisa aparecer: usa o range + 12%
        //    de folga em cada lado (span × 1,24), como antes.
        //  • Movimento TRIVIAL (centavos de ruído) NÃO pode virar uma "montanha": a
        //    banda nunca é menor que ~0,5% do patrimônio. Assim, variação irrelevante
        //    fica quase reta (honesto) e as casas decimais do eixo ficam limitadas
        //    (rótulos nunca colam). Série chapada (span 0) cai no mesmo piso.
        const span = max - min;
        const mid = (min + max) / 2;
        const band = Math.max(span * 1.24, mid * 0.005, 10);
        min = Math.max(0, mid - band / 2);
        max = mid + band / 2;

        // Passo "nice" (1/2/2.5/5/10 × 10ⁿ) para ~5 divisões.
        const rawStep = (max - min) / 5 || 1;
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const norm = rawStep / mag;
        const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;

        const domainMin = Math.max(0, Math.floor(min / step) * step);
        const domainMax = Math.ceil(max / step) * step;
        const ticks: number[] = [];
        for (let v = domainMin; v <= domainMax + step * 0.5; v += step) ticks.push(Number(v.toFixed(6)));

        // Unidade única para todo o eixo (mesma escala/decimais em todos os ticks).
        const maxAbs = Math.max(Math.abs(domainMin), Math.abs(domainMax));
        const divisor = maxAbs >= 1_000_000 ? 1_000_000 : maxAbs >= 1_000 ? 1_000 : 1;
        const suffix = divisor === 1_000_000 ? 'M' : divisor === 1_000 ? 'k' : '';
        const unitStep = step / divisor;
        // Casas decimais que tornam ticks adjacentes distintos na unidade escolhida.
        const decimals = unitStep >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(unitStep)));

        return { domain: [domainMin, domainMax] as [number, number], ticks, divisor, suffix, decimals };
    }, [chartData]);

    const formatAxisCurrency = (val: number) => {
        if (isPrivacyMode) return '••••••';
        if (!yScale) return `R$ ${val.toFixed(0)}`;
        return `R$ ${(val / yScale.divisor).toFixed(yScale.decimals)}${yScale.suffix}`;
    };

    const summary = useMemo(() => summarizeEvolutionWindow(chartData), [chartData]);
    const showSummary = summary.variationValue !== 0 || summary.variationPercent !== null;
    const summaryPositive = summary.variationValue >= 0;

    // Ponto LIVE (última barra): bolinha destacada + bolha flutuante com o saldo atual.
    // Recharts chama esta função para cada ponto da série; só desenhamos no último.
    const renderEndDot = (props: any): React.ReactElement => {
        const { cx, cy, index, payload } = props;
        if (cx == null || cy == null || payload?.isVisualAnchor || index !== renderData.length - 1) return <g key={`d${index}`} />;
        const label = formatTooltipCurrency(payload.realEquity);
        const bw = Math.max(78, label.length * 7.2 + 18);
        const bx = cx - bw - 6; // bolha à esquerda do ponto (o ponto vive na borda direita)
        return (
            <g>
                <rect x={bx} y={cy - 30} width={bw} height={22} rx={7} fill={bubbleBg} />
                <text x={bx + bw / 2} y={cy - 15} textAnchor="middle" fontSize={11.5} fontWeight={800} fill={bubbleText}>
                    {label}
                </text>
                <circle cx={cx} cy={cy} r={5} fill={dotFill} stroke="#0e9268" strokeWidth={2.6} />
            </g>
        );
    };

    // A âncora artificial não deve reagir ao hover nem exibir um segundo ponto.
    const renderActiveDot = (props: any): React.ReactElement => {
        const { cx, cy, payload, index } = props;
        if (cx == null || cy == null || payload?.isVisualAnchor) return <g key={`a${index}`} />;
        return <circle cx={cx} cy={cy} r={4} fill="#0e9268" stroke={dotFill} strokeWidth={2} />;
    };

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
                            <span className={`text-xs font-bold tabular-nums ${summaryPositive ? 'text-emerald-400' : 'text-red-500'}`}>
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
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#8fd6bd' }}></span>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Valor Aplicado</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#0e9268' }}></span>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">Patrimônio</p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Granularidade: Diário vs Mensal */}
                    <div className="flex bg-deep p-1 rounded-lg border border-slate-800">
                        {(['DAILY', 'MONTHLY'] as const).map((g) => (
                            <button
                                key={g}
                                onClick={() => switchGranularity(g)}
                                className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                    granularity === g
                                    ? 'bg-base text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {g === 'DAILY' ? 'Diário' : 'Mensal'}
                            </button>
                        ))}
                    </div>

                    {/* Janela — depende da granularidade */}
                    <div className="flex bg-deep p-1 rounded-lg border border-slate-800">
                        {WINDOW_OPTIONS[granularity].map((w) => (
                            <button
                                key={w}
                                onClick={() => setRange(w)}
                                className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${
                                    range === w
                                    ? 'bg-base text-white shadow-sm'
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
                    <ComposedChart data={renderData} margin={{ top: 30, right: 14, left: -4, bottom: 0 }}>
                        <defs>
                            <linearGradient id="evoEquityFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#0e9268" stopOpacity={0.22} />
                                <stop offset="100%" stopColor="#0e9268" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 4" stroke={gridStroke} vertical={false} />

                        <XAxis
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            minTickGap={10}
                            // Usa o componente customizado para desenhar o ponto live
                            tick={(props) => <CustomXAxisTick {...props} data={renderData} />}
                        />

                        <YAxis
                            domain={yScale?.domain ?? ['auto', 'auto']}
                            ticks={yScale?.ticks}
                            allowDataOverflow={false}
                            tickFormatter={formatAxisCurrency}
                            tick={{fill: '#64748b', fontSize: 10}}
                            axisLine={false}
                            tickLine={false}
                        />

                        <Tooltip
                            cursor={{ stroke: cursorStroke, strokeWidth: 1, strokeDasharray: '4 4' }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    if (data.isVisualAnchor) return null;
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
                                                    <span className="text-slate-200 tabular-nums whitespace-nowrap">{formatTooltipCurrency(data.realInvested)}</span>
                                                </div>
                                                <div className="flex justify-between items-center gap-6 text-xs">
                                                    <span className="text-emerald-400 font-bold">Resultado</span>
                                                    <span className={`tabular-nums font-bold whitespace-nowrap ${data.realProfit >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
                                                        {data.realProfit >= 0 ? '+' : ''}{formatTooltipCurrency(data.realProfit)}
                                                    </span>
                                                </div>

                                                <div className="flex justify-between items-center gap-6 text-xs">
                                                    <span className="text-slate-400 font-bold whitespace-nowrap">Variação no período</span>
                                                    <span className={`tabular-nums font-bold whitespace-nowrap text-right ${variationColor}`}>
                                                        {variationSign}{formatTooltipCurrency(variation)}
                                                        {variationPct !== null && variationPct !== undefined && (
                                                            <span className="block text-[10px] font-sans opacity-80">{formatPercent(variationPct, { sign: true })}</span>
                                                        )}
                                                    </span>
                                                </div>

                                                <div className="border-t border-slate-800 pt-1.5 mt-1 flex justify-between items-center gap-6">
                                                    <span className="text-white font-bold text-xs uppercase whitespace-nowrap">Saldo Final</span>
                                                    <span className="text-white font-bold tabular-nums text-sm whitespace-nowrap">{formatTooltipCurrency(data.realEquity)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />

                        {/* Preenchimento do patrimônio (sem traço — o traço é a Line abaixo, p/ camadas) */}
                        <Area
                            type="monotone"
                            dataKey="realEquity"
                            stroke="none"
                            fill="url(#evoEquityFill)"
                            isAnimationActive={false}
                        />

                        {/* Linha tracejada do Valor Aplicado (custo) */}
                        <Line
                            type="monotone"
                            dataKey="realInvested"
                            stroke="#8fd6bd"
                            strokeWidth={1.8}
                            strokeDasharray="5 4"
                            dot={false}
                            activeDot={false}
                            isAnimationActive={false}
                        />

                        {/* Linha do Patrimônio (verde) + ponto/bolha do dia LIVE */}
                        <Line
                            type="monotone"
                            dataKey="realEquity"
                            stroke="#0e9268"
                            strokeWidth={2.6}
                            dot={renderEndDot}
                            activeDot={renderActiveDot}
                            animationDuration={900}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
});
