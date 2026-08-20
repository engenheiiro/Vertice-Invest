
import React, { useMemo, useRef, useState } from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { useTheme } from '../../contexts/ThemeContext';
import { ComposedChart, Area, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart3, Activity } from 'lucide-react';
import { formatCurrency as fmtCurrency, formatPercent } from '../../utils/format';
import { buildEvolutionChartData, buildEvolutionRenderData, summarizeEvolutionWindow, type ChartGranularity, type ChartWindow } from '../../utils/evolutionChartData';

// Preferência de visualização (linha ↔ barras). Persistida por navegador: é uma
// escolha estética do usuário, não um filtro de dados.
type ChartType = 'LINE' | 'BAR';
const CHART_TYPE_KEY = 'evolutionChartType';

const readStoredChartType = (): ChartType => {
    try {
        return localStorage.getItem(CHART_TYPE_KEY) === 'BAR' ? 'BAR' : 'LINE';
    } catch {
        return 'LINE';
    }
};

// Cores das barras empilhadas — mesma família verde da linha, para o gráfico
// trocar de forma sem trocar de identidade.
const BAR_BASE = '#0e9268';    // porção "Valor Aplicado" (corpo da barra)
const BAR_PROFIT = '#5fd6ae';  // capa clara = Resultado positivo
const BAR_LOSS = '#ef4444';    // capa vermelha = queda abaixo do custo

// Barra com o topo arredondado apenas quando é o segmento mais alto da pilha —
// arredondar segmentos do meio abriria "degraus" entre eles.
const RoundedBar = (props: any): React.ReactElement => {
    const { x, y, width, height, fill, radius = 0 } = props;
    if (!(height > 0) || !(width > 0)) return <g />;
    const r = Math.max(0, Math.min(radius, width / 2, height));
    if (r === 0) return <rect x={x} y={y} width={width} height={height} fill={fill} />;
    const d = `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y}`
        + ` L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r}`
        + ` L${x + width},${y + height} Z`;
    return <path d={d} fill={fill} />;
};

// Custom Tick para exibir o ponto pulsante no dia LIVE
const CustomXAxisTick = (props: any) => {
    const { x, y, payload, data } = props;

    // Encontra o item correspondente ao tick atual
    const item = data && data[payload.index];
    const isLive = item && item.isLive;

    // O ponto LIVE fica à ESQUERDA do rótulo, encostado na largura real do texto —
    // antes vivia num deslocamento fixo (cx=14) e caía POR CIMA de rótulos com mais
    // de ~5 caracteres ("ago/2026" virava "ago/20●6"). À esquerda também evita que
    // ele estoure a borda direita do card no último tick, que é justamente o LIVE.
    const label = String(payload.value ?? '');
    const textHalf = (label.length * 5.4) / 2; // ~5,4px por caractere em fontSize 10
    const DOT_SPACE = 16;                      // espaço reservado ao ponto + respiro
    const shift = isLive ? DOT_SPACE / 2 : 0;  // recentra o conjunto ponto + texto
    const dotX = shift - textHalf - 9;

    return (
        <g transform={`translate(${x},${y})`}>
            <text
                x={shift}
                y={0}
                dy={12}
                textAnchor="middle"
                fill="#64748b"
                fontSize={10}
                fontWeight={500}
            >
                {label}
            </text>
            {isLive && (
                // Ponto Pulsante Vermelho. transformBox/transformOrigin no círculo
                // animado fazem o `animate-ping` escalar em torno dele mesmo — sem
                // isso o SVG usa a origem do viewBox e a onda dispara para fora do
                // gráfico (as duas propriedades não são herdadas do <g>).
                <g>
                    <circle
                        cx={dotX}
                        cy={8}
                        r={3}
                        fill="#ef4444"
                        className="animate-ping opacity-75"
                        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    />
                    <circle cx={dotX} cy={8} r={2} fill="#ef4444" />
                </g>
            )}
        </g>
    );
};

// Eixo Y a partir de uma faixa [min, max]: ticks em passos "redondos"
// (1/2/2.5/5/10 × 10ⁿ) e casas decimais derivadas do próprio passo — assim os
// rótulos ficam distintos em qualquer zoom (antes, numa faixa apertada,
// (val/1000).toFixed(0) colava tudo em "15k").
function buildScale(min: number, max: number) {
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
    const decimals = unitStep >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(unitStep)));

    return { domain: [domainMin, domainMax] as [number, number], ticks, divisor, suffix, decimals };
}

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
    const [chartType, setChartType] = useState<ChartType>(readStoredChartType);
    const isBar = chartType === 'BAR';
    // Largura do plot só para ancorar a bolha LIVE dentro do card no modo barra.
    const plotRef = useRef<HTMLDivElement>(null);

    const switchChartType = (t: ChartType) => {
        setChartType(t);
        try { localStorage.setItem(CHART_TYPE_KEY, t); } catch { /* storage indisponível */ }
    };

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
    // No modo barra ela é dispensável (uma categoria única já vira uma barra) e
    // seria nociva: renderizaria uma barra fantasma duplicando o ponto LIVE.
    const renderData = useMemo(
        () => (isBar ? chartData : buildEvolutionRenderData(chartData)),
        [chartData, isBar]
    );

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

        // Barra sempre nasce no zero: ela codifica GRANDEZA por área, então cortar
        // a base exageraria a diferença entre períodos (o vício clássico do gráfico
        // de barras truncado). A linha, que codifica trajetória, mantém o zoom.
        // (o arredondamento do topo para o próximo tick "redondo" já cria a folga
        // que a bolha do LIVE precisa; por isso a margem aqui é mínima)
        if (isBar) return buildScale(0, max * 1.02);

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

        return buildScale(Math.max(0, mid - band / 2), mid + band / 2);
    }, [chartData, isBar]);

    const formatAxisCurrency = (val: number) => {
        if (isPrivacyMode) return '••••••';
        if (!yScale) return `R$ ${val.toFixed(0)}`;
        return `R$ ${(val / yScale.divisor).toFixed(yScale.decimals)}${yScale.suffix}`;
    };

    // The Recharts Text component can wrap the label at the space after "R$"
    // when the axis becomes narrow. Native SVG text preserves it as one label.
    const renderYAxisTick = ({ x, y, payload }: any): React.ReactElement => (
        <text
            x={x}
            y={y}
            dy={3}
            textAnchor="end"
            fill="#64748b"
            fontSize={10}
        >
            {formatAxisCurrency(payload.value)}
        </text>
    );

    // Legenda acompanha a forma: na linha as séries são Aplicado × Patrimônio; na
    // barra os segmentos empilhados são Aplicado + Resultado (ou perda, quando há).
    const legend = useMemo(() => {
        if (!isBar) {
            return [
                { label: 'Valor Aplicado', color: '#8fd6bd' },
                { label: 'Patrimônio', color: BAR_BASE },
            ];
        }
        const items = [
            { label: 'Valor Aplicado', color: BAR_BASE },
            { label: 'Resultado', color: BAR_PROFIT },
        ];
        if (chartData.some((p) => p.lossBar > 0)) items.push({ label: 'Prejuízo', color: BAR_LOSS });
        return items;
    }, [isBar, chartData]);

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
        // Linha: bolha à esquerda do ponto (o ponto vive na borda direita).
        // Barra: centralizada sobre a última barra, presa dentro do plot.
        const plotWidth = plotRef.current?.clientWidth ?? cx + bw + 8;
        const bx = isBar
            ? Math.max(2, Math.min(cx - bw / 2, plotWidth - bw - 4))
            : cx - bw - 6;
        const by = isBar ? cy - 26 : cy - 30;
        return (
            <g>
                <rect x={bx} y={by} width={bw} height={22} rx={7} fill={bubbleBg} />
                <text x={bx + bw / 2} y={by + 15} textAnchor="middle" fontSize={11.5} fontWeight={800} fill={bubbleText}>
                    {label}
                </text>
                {!isBar && <circle cx={cx} cy={cy} r={5} fill={dotFill} stroke="#0e9268" strokeWidth={2.6} />}
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
            <div className="bg-base border border-slate-800 rounded-2xl p-4 sm:p-6 h-[400px] sm:h-[420px] flex flex-col items-center justify-center text-center relative overflow-hidden group">
                <BarChart3 className="text-slate-700 mb-4" size={48} />
                <h3 className="text-slate-300 font-bold text-sm">Sem dados históricos</h3>
                <p className="text-slate-600 text-xs">O gráfico será gerado após o primeiro aporte.</p>
            </div>
        );
    }

    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-4 sm:p-6 h-[420px] flex flex-col relative overflow-hidden shadow-sm hover:border-slate-700 transition-colors">

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 sm:mb-6 gap-3 sm:gap-4 z-10 relative">
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
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {legend.map((item) => (
                            <div key={item.label} className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }}></span>
                                <p className="text-[10px] text-slate-400 font-bold uppercase">{item.label}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex w-full min-w-0 flex-nowrap items-center gap-2 sm:w-auto">
                    {/* Formato: linha vs barras (preferência visual do usuário) */}
                    <div className="flex shrink-0 bg-deep p-1 rounded-lg border border-slate-800">
                        {([['LINE', Activity, 'Linha'], ['BAR', BarChart3, 'Barras']] as const).map(([t, Icon, title]) => (
                            <button
                                key={t}
                                onClick={() => switchChartType(t)}
                                title={`Visualizar em ${title.toLowerCase()}`}
                                aria-label={`Visualizar em ${title.toLowerCase()}`}
                                aria-pressed={chartType === t}
                                className={`px-2 min-h-[32px] inline-flex items-center justify-center rounded transition-all ${
                                    chartType === t
                                    ? 'bg-base text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                <Icon size={13} strokeWidth={2.5} />
                            </button>
                        ))}
                    </div>

                    {/* Granularidade: Diário vs Mensal */}
                    <div className="flex shrink-0 bg-deep p-1 rounded-lg border border-slate-800">
                        {(['DAILY', 'MONTHLY'] as const).map((g) => (
                            <button
                                key={g}
                                onClick={() => switchGranularity(g)}
                                className={`px-2 sm:px-3 min-h-[32px] inline-flex items-center justify-center text-[10px] font-bold rounded transition-all ${
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
                    <div className="flex min-w-0 flex-1 bg-deep p-1 rounded-lg border border-slate-800 sm:flex-none">
                        {WINDOW_OPTIONS[granularity].map((w) => (
                            <button
                                key={w}
                                onClick={() => setRange(w)}
                                className={`min-w-0 flex-1 px-1.5 sm:flex-none sm:px-3 min-h-[32px] inline-flex items-center justify-center text-[10px] font-bold rounded transition-all ${
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
            <div ref={plotRef} className="flex-1 w-full relative min-h-0 text-xs" role="img" aria-label="Gráfico de evolução patrimonial da carteira ao longo do tempo" aria-describedby="evolution-chart-desc">
                <p id="evolution-chart-desc" className="sr-only">
                    {isBar ? 'Gráfico de barras' : 'Gráfico de linhas'} exibindo o patrimônio total da carteira. Alterne entre visão diária e mensal e use os controles de período para ajustar a janela exibida.
                    {showSummary && !isPrivacyMode && ` Resultado no período: ${formatSignedCurrency(summary.variationValue)}${summary.variationPercent !== null ? ` (${formatPercent(summary.variationPercent, { sign: true })})` : ''}.`}
                </p>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={renderData}
                        margin={{ top: 30, right: 6, left: -4, bottom: 0 }}
                        // Respiro entre barras na janela Diária (30/90 pontos); no
                        // mensal o maxBarSize já governa a largura.
                        barCategoryGap="22%"
                    >
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
                            width={58}
                            tick={renderYAxisTick}
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
                                    // O rótulo diz CONTRA O QUE a variação foi medida, porque na
                                    // mesma tela convivem três réguas: a do dia (card), a do ponto
                                    // anterior e a da janela inteira (cabeçalho). Chamar as três de
                                    // "no período" fazia parecer que os números se contradiziam.
                                    //   • ponto de HOJE no diário → "Variação hoje", com o MESMO
                                    //     número do card (buildEvolutionChartData força isso);
                                    //   • demais pontos → nomeia o comparativo ("vs 30/06");
                                    //   • sem ponto anterior → o número é o acumulado, e aí o
                                    //     texto genérico é o honesto.
                                    const variationLabel = data.isDayVariation
                                        ? 'Variação hoje'
                                        : data.previousLabel
                                            ? `Variação vs ${data.previousLabel}`
                                            : 'Variação no período';
                                    const isLive = data.isLive;
                                    // Zero é NEUTRO (cinza), não verde nem vermelho — dia sem
                                    // movimento (ex.: fim de semana de renda fixa) não é ganho
                                    // nem perda. Evita o "-R$ 0,00" vermelho por ruído de float.
                                    const variationColor = variation > 0 ? 'text-emerald-400' : variation < 0 ? 'text-red-500' : 'text-slate-400';
                                    const variationSign = variation > 0 ? '+' : '';

                                    return (
                                        <div className="w-[210px] max-w-[calc(100vw-2rem)] bg-elevated border border-slate-700 rounded-xl p-3 shadow-2xl z-50 sm:w-auto sm:max-w-none sm:min-w-[210px]">
                                            <div className="flex justify-between items-center gap-2 sm:gap-4 border-b border-slate-800 pb-1.5 mb-2">
                                                <p className="text-slate-400 text-[10px] font-bold uppercase">{displayLabel}</p>
                                                {isLive && <span className="text-[9px] text-red-500 font-black animate-pulse flex items-center gap-1 whitespace-nowrap">● LIVE</span>}
                                            </div>

                                            <div className="space-y-1.5">
                                                <div className="flex justify-between items-center gap-2 sm:gap-6 text-xs">
                                                    <span className="text-emerald-600 font-bold">Aplicado</span>
                                                    <span className="text-slate-200 tabular-nums whitespace-nowrap">{formatTooltipCurrency(data.realInvested)}</span>
                                                </div>
                                                <div className="flex justify-between items-center gap-2 sm:gap-6 text-xs">
                                                    <span className="text-emerald-400 font-bold">Resultado</span>
                                                    <span className={`tabular-nums font-bold whitespace-nowrap ${data.realProfit >= 0 ? 'text-emerald-400' : 'text-red-500'}`}>
                                                        {data.realProfit >= 0 ? '+' : ''}{formatTooltipCurrency(data.realProfit)}
                                                    </span>
                                                </div>

                                                <div className="flex justify-between items-center gap-2 sm:gap-6 text-xs">
                                                    <span className="text-[10px] leading-tight text-slate-400 font-bold sm:text-xs sm:whitespace-nowrap">{variationLabel}</span>
                                                    <span className={`tabular-nums font-bold whitespace-nowrap text-right ${variationColor}`}>
                                                        {variationSign}{formatTooltipCurrency(variation)}
                                                        {variationPct !== null && variationPct !== undefined && (
                                                            <span className="block text-[10px] font-sans opacity-80">{formatPercent(variationPct, { sign: true })}</span>
                                                        )}
                                                    </span>
                                                </div>

                                                <div className="border-t border-slate-800 pt-1.5 mt-1 flex justify-between items-center gap-2 sm:gap-6">
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

                        {isBar ? (
                            <>
                                {/* Pilha: Aplicado (corpo) + Resultado (capa clara) OU perda (capa
                                    vermelha até o custo). profitBar e lossBar são mutuamente
                                    exclusivos, então só uma capa existe por barra. */}
                                <Bar
                                    dataKey="baseBar"
                                    stackId="equity"
                                    fill={BAR_BASE}
                                    maxBarSize={46}
                                    shape={(p: any) => (
                                        <RoundedBar {...p} radius={p.payload.profitBar > 0 || p.payload.lossBar > 0 ? 0 : 5} />
                                    )}
                                    animationDuration={700}
                                />
                                <Bar
                                    dataKey="profitBar"
                                    stackId="equity"
                                    fill={BAR_PROFIT}
                                    maxBarSize={46}
                                    shape={(p: any) => <RoundedBar {...p} radius={5} />}
                                    animationDuration={700}
                                />
                                <Bar
                                    dataKey="lossBar"
                                    stackId="equity"
                                    fill={BAR_LOSS}
                                    maxBarSize={46}
                                    shape={(p: any) => <RoundedBar {...p} radius={5} />}
                                    animationDuration={700}
                                />

                                {/* Série invisível no topo da pilha: só carrega a bolha do LIVE. */}
                                <Line
                                    dataKey={(d: any) => Math.max(d.realEquity, d.realInvested)}
                                    stroke="none"
                                    dot={renderEndDot}
                                    activeDot={false}
                                    legendType="none"
                                    isAnimationActive={false}
                                />
                            </>
                        ) : (
                            <>
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
                            </>
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
});
