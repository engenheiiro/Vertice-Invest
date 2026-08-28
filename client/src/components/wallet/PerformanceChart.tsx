
import React, { useEffect, useState, useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { walletService } from '../../services/wallet';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp, RefreshCw } from 'lucide-react';
import { useDemo } from '../../contexts/DemoContext';
import { useWallet } from '../../contexts/WalletContext';
import { DEMO_PERFORMANCE } from '../../data/DEMO_DATA';
import { formatCurrency as fmtCurrency } from '../../utils/format';

interface PerformancePoint {
    date: string;
    wallet: number;
    walletRoi: number;
    equity?: number;
    invested?: number;
    cdi: number;
    ibov: number;
    ipca?: number;
    // Valores cashflow-aware (R$) calculados no backend.
    cdiValue?: number;
    ipcaValue?: number;
    ibovValue?: number;
}

// Datas da API sÃ£o chaves de calendÃ¡rio (YYYY-MM-DD), nÃ£o instantes UTC.
// new Date('2026-08-01') representa 31/07 Ã  noite no fuso de SÃ£o Paulo e faz
// o ponto do primeiro dia do mÃªs desaparecer do filtro "MÃªs".
const parsePerformanceDate = (date: string): Date => {
    const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (calendarDate) {
        const [, year, month, day] = calendarDate;
        return new Date(Number(year), Number(month) - 1, Number(day));
    }
    return new Date(date);
};


const LABEL_MAP: Record<string, string> = {
    walletVal: 'Minha Carteira',
    cdi:       'CDI',
    ipca:      'Meta real · IPCA + 6% a.a.',
    ibov:      'Ibovespa',
    walletBRL: 'Minha Carteira',
    cdiBRL:    'CDI',
    ipcaBRL:   'Meta real · IPCA + 6% a.a.',
    ibovBRL:   'Ibovespa',
};

export const PerformanceChart = React.memo(() => {
    const [data, setData] = useState<PerformancePoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [timeRange, setTimeRange] = useState<'1M' | '12M' | 'YTD' | 'ALL'>('ALL');
    const [viewMode, setViewMode] = useState<'pct' | 'brl'>('pct');
    const [showIbov, setShowIbov] = useState(false);
    const { theme } = useTheme();
    // Tooltip: no escuro usa a superfície ELEVATED do tema novo (#202631) + borda
    // slate-700 — mesma "casa" do tooltip do EvolutionChart (bg-elevated). Antes
    // apontava para #1B212B, que após escurecermos a paleta virou um tom mais claro
    // que os cards (caixa fora da paleta).
    const chartTooltipStyle = theme === 'light'
        ? { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', fontSize: '12px', zIndex: 100, color: '#0f172a' }
        : { backgroundColor: '#202631', borderColor: '#334155', borderRadius: '8px', fontSize: '12px', zIndex: 100 };
    // Ibovespa é neutro (cinza) em ambos os temas, mas o tom precisa inverter: prata
    // claro some no fundo branco e cinza-escuro some no fundo escuro. slate-600 no
    // claro / slate-300 no escuro garante contraste nos dois.
    const ibovStroke = theme === 'light' ? '#475569' : '#cbd5e1';
    // Grade/cursor/rótulos theme-aware — mesma convenção do EvolutionChart, p/ os dois
    // gráficos da Carteira ficarem idênticos no tema novo (escuro grafite).
    const gridStroke = theme === 'light' ? '#eef1f5' : '#232B36';
    // Cursor do tooltip: no escuro era branco puro (#fff) — clarão que destoava do
    // tema; agora slate-700 (#334155), igual ao EvolutionChart.
    const cursorStroke = theme === 'light' ? '#cbd5e1' : '#334155';
    // Rótulos dos eixos: slate-500 no claro; cinza-frio do mockup (#6A7480) no escuro.
    const axisTick = theme === 'light' ? '#64748b' : '#6A7480';

    const { isDemoMode } = useDemo();
    const { kpis, activeWalletId, isWalletScopeReady } = useWallet();

    const loadPerformance = async () => {
        setIsLoading(true);

        if (isDemoMode) {
            setTimeout(() => {
                setData(DEMO_PERFORMANCE);
                setIsLoading(false);
            }, 600);
            return;
        }

        try {
            const res = await walletService.getPerformance(activeWalletId);
            const sorted = Array.isArray(res?.history)
                ? res.history.sort((a: any, b: any) => parsePerformanceDate(a.date).getTime() - parsePerformanceDate(b.date).getTime())
                : [];
            setData(sorted);
        } catch (e) {
            console.error('Erro carregando performance:', e);
            setData([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        // Espera a carteira ativa ser resolvida: buscar antes traria a performance
        // sem escopo e o efeito rodaria de novo com o id (duas chamadas caras).
        if (!isWalletScopeReady) return;
        loadPerformance();
        // `loadPerformance` é recriada a cada render; como dependência ela anularia
        // justamente o cuidado descrito acima, refazendo a chamada cara a cada
        // render em vez de só quando o escopo/carteira muda.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDemoMode, activeWalletId, isWalletScopeReady]);

    // --- RECONCILIAÇÃO COM OS KPIs ---
    // O último ponto representa "agora". O ponto live do backend pode divergir
    // do patrimônio/TWRR autoritativos (calculado por outro caminho). Ancoramos
    // o fim da série nos KPIs da carteira para o gráfico SEMPRE bater com os
    // cards de Patrimônio Líquido e Rentabilidade Real.
    const reconciledData = useMemo(() => {
        if (isDemoMode || data.length === 0 || !kpis || kpis.totalEquity <= 0) return data;
        const out = data.slice();
        const i = out.length - 1;
        out[i] = {
            ...out[i],
            equity: kpis.totalEquity,
            wallet: kpis.weightedRentability,
            walletRoi: typeof kpis.totalResultPercent === 'number' ? kpis.totalResultPercent : out[i].walletRoi,
        };
        return out;
    }, [data, kpis, isDemoMode]);

    // --- FILTRAGEM DE DADOS (TIME RANGE) ---
    const filteredData = useMemo(() => {
        const base = reconciledData;
        if (!base || base.length === 0) return [];
        if (timeRange === 'ALL') return base;

        const now = new Date();
        const cutoffDate = new Date();

        if (timeRange === '1M') {
            cutoffDate.setDate(1);
            cutoffDate.setHours(0, 0, 0, 0);
        } else if (timeRange === '12M') {
            cutoffDate.setFullYear(now.getFullYear() - 1);
        } else if (timeRange === 'YTD') {
            cutoffDate.setMonth(0, 1);
            cutoffDate.setHours(0, 0, 0, 0);
        }

        const firstPointInRange = base.findIndex(point => parsePerformanceDate(point.date) >= cutoffDate);

        // MantÃ©m o Ãºltimo ponto anterior como base da curva. No primeiro dia do
        // mÃªs a sÃ©rie frequentemente tem apenas o ponto live; sem a base, o
        // Recharts nÃ£o tem um segmento para desenhar e o grÃ¡fico fica em branco.
        if (firstPointInRange > 0) return base.slice(firstPointInRange - 1);
        if (firstPointInRange === -1) return base.slice(-2);
        return base;
    }, [reconciledData, timeRange]);

    // --- DADOS PARA MODO R$ ---
    // "Minha Carteira" usa o patrimônio REAL (p.equity) — bate com o KPI no
    // último ponto. Benchmarks usam os valores cashflow-aware do backend
    // (cdiValue/ipcaValue/ibovValue): mesmo capital + aportes, crescido pelo índice.
    const displayData = useMemo(() => {
        if (viewMode === 'pct') return filteredData;
        return filteredData.map(p => ({
            ...p,
            walletBRL: p.equity ?? 0,
            cdiBRL:    p.cdiValue ?? 0,
            ipcaBRL:   p.ipcaValue ?? 0,
            ibovBRL:   p.ibovValue ?? 0,
        }));
    }, [filteredData, viewMode]);

    // --- GERAÇÃO DE TICKS DO EIXO X ---
    const xAxisTicks = useMemo(() => {
        if (filteredData.length === 0) return [];
        const ticks: string[] = [];

        if (timeRange === '1M') {
            filteredData.forEach((point, index) => {
                if (index % 2 === 0 || index === filteredData.length - 1) {
                    ticks.push(point.date);
                }
            });
        } else {
            const seenMonths = new Set();
            filteredData.forEach(point => {
                const d = parsePerformanceDate(point.date);
                const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
                if (!seenMonths.has(key)) {
                    ticks.push(point.date);
                    seenMonths.add(key);
                }
            });
        }
        return ticks;
    }, [filteredData, timeRange]);

    const tickInterval = (timeRange === '1M' || timeRange === '12M' || timeRange === 'YTD') ? 0 : 'preserveStartEnd';

    if (isLoading) {
        return (
            <div className="bg-base border border-slate-800 rounded-2xl p-4 sm:p-6 h-[400px] sm:h-[420px] flex items-center justify-center animate-pulse">
                <div className="text-center">
                    <RefreshCw className="animate-spin text-blue-500 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">Calculando rentabilidade relativa...</p>
                </div>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="bg-base border border-slate-800 rounded-2xl p-4 sm:p-6 h-[400px] sm:h-[420px] flex items-center justify-center">
                <p className="text-slate-500 text-sm">Dados insuficientes para comparação histórica.</p>
            </div>
        );
    }

    const lastPoint = filteredData[filteredData.length - 1];
    const lastDisplay = displayData[displayData.length - 1] as any;
    const currentWalletValue = lastPoint?.wallet ?? 0;
    const walletWin = viewMode === 'pct'
        ? lastPoint && currentWalletValue > lastPoint.cdi && (!showIbov || currentWalletValue > (lastPoint.ibov || 0))
        : lastDisplay && lastDisplay.walletBRL > lastDisplay.cdiBRL && (!showIbov || lastDisplay.walletBRL > lastDisplay.ibovBRL);

    const walletDataKey = viewMode === 'brl' ? 'walletBRL' : 'wallet';

    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-4 sm:p-6 h-[400px] sm:h-[420px] flex flex-col relative overflow-hidden shadow-sm hover:border-slate-700 transition-colors">

            {/* HEADER COM CONTROLES */}
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
                        {(['1M', 'YTD', '12M', 'ALL'] as const).map((t) => (
                            <button
                                key={t}
                                onClick={() => setTimeRange(t)}
                                className={`px-3 min-h-[32px] inline-flex items-center justify-center text-[10px] font-bold rounded transition-all ${
                                    timeRange === t
                                        ? 'bg-base text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {t === '1M' ? 'Mês' : t === 'ALL' ? 'Tudo' : t}
                            </button>
                        ))}
                    </div>

                    <div className="w-px h-6 bg-slate-800 hidden sm:block"></div>

                    {/* CONTROLE % vs R$ */}
                    <div className="bg-deep p-1 rounded-lg border border-slate-800 flex gap-1">
                        <button
                            onClick={() => setViewMode('pct')}
                            className={`px-3 min-h-[32px] inline-flex items-center justify-center text-[10px] font-bold rounded transition-all ${
                                viewMode === 'pct'
                                    ? 'bg-base text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-300'
                            }`}
                            title="Rentabilidade percentual"
                        >
                            %
                        </button>
                        <button
                            onClick={() => setViewMode('brl')}
                            className={`px-3 min-h-[32px] inline-flex items-center justify-center text-[10px] font-bold rounded transition-all ${
                                viewMode === 'brl'
                                    ? 'bg-base text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-300'
                            }`}
                            title="Valor em R$"
                        >
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

            {/* Legenda também concentra opções que afetam a escala do gráfico. */}
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
                    onClick={() => setShowIbov((visible) => !visible)}
                    aria-pressed={showIbov}
                    aria-label={showIbov ? 'Ocultar Ibovespa' : 'Exibir Ibovespa'}
                    className={`group inline-flex min-h-[30px] items-center gap-2 rounded-full border px-2.5 py-1 transition-all ${
                        showIbov
                            ? 'border-slate-500 bg-slate-700/40 text-slate-200 shadow-sm'
                            : 'border-slate-800 bg-deep/80 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                    }`}
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

            {/* (A1) descrição textual do gráfico para leitores de tela */}
            <div className="flex-1 w-full text-xs min-h-0" role="img" aria-label={`Gráfico de rentabilidade da carteira comparada aos benchmarks CDI, IPCA${showIbov ? ' e Ibovespa' : ''}`} aria-describedby="performance-chart-desc">
                <p id="performance-chart-desc" className="sr-only">
                    Gráfico de área comparando a rentabilidade TWRR da carteira com CDI e a meta real de IPCA mais 6% ao ano{showIbov ? ' e Ibovespa' : ''}. Use os controles acima para alterar o período e alternar entre percentual e visão em reais.
                </p>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={displayData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorWallet" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.28} />
                                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />

                        <XAxis
                            dataKey="date"
                            tick={{ fill: axisTick, fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            ticks={xAxisTicks}
                            interval={tickInterval}
                            tickFormatter={(val) => {
                                try {
                                    const d = parsePerformanceDate(val);
                                    if (isNaN(d.getTime())) return val;
                                    if (timeRange === '1M') {
                                        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
                                    }
                                    const m = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
                                    const y = d.toLocaleDateString('pt-BR', { year: '2-digit' });
                                    return `${m}/${y}`;
                                } catch { return val; }
                            }}
                            minTickGap={10}
                        />

                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: axisTick, fontSize: 10 }}
                            domain={['auto', 'auto']}
                            tickFormatter={(val) =>
                                viewMode === 'brl'
                                    ? `R$${(val / 1000).toFixed(0)}k`
                                    : `${val.toFixed(0)}%`
                            }
                        />

                        <Tooltip
                            contentStyle={chartTooltipStyle}
                            itemStyle={{ fontWeight: 'bold' }}
                            labelStyle={{ color: '#94a3b8', marginBottom: '5px' }}
                            formatter={(value: number, name: string) => {
                                const label = LABEL_MAP[name] ?? name;
                                if (viewMode === 'brl') {
                                    return [fmtCurrency(value), label];
                                }
                                return [`${value.toFixed(2)}%`, label];
                            }}
                            labelFormatter={(label) => parsePerformanceDate(label).toLocaleDateString('pt-BR')}
                            cursor={{ stroke: cursorStroke, strokeWidth: 1, strokeDasharray: '4 4' }}
                        />

                        <Area
                            type="monotone"
                            dataKey={viewMode === 'brl' ? 'ipcaBRL' : 'ipca'}
                            name={viewMode === 'brl' ? 'ipcaBRL' : 'ipca'}
                            stroke="#d946ef"
                            strokeWidth={2}
                            strokeDasharray="2 2"
                            fill="transparent"
                            activeDot={false}
                        />

                        {showIbov && (
                            <Area
                                type="monotone"
                                dataKey={viewMode === 'brl' ? 'ibovBRL' : 'ibov'}
                                name={viewMode === 'brl' ? 'ibovBRL' : 'ibov'}
                                stroke={ibovStroke}
                                strokeWidth={2}
                                fill="transparent"
                                strokeDasharray="6 3"
                                activeDot={false}
                            />
                        )}

                        <Area
                            type="monotone"
                            dataKey={viewMode === 'brl' ? 'cdiBRL' : 'cdi'}
                            name={viewMode === 'brl' ? 'cdiBRL' : 'cdi'}
                            stroke="#fbbf24"
                            strokeWidth={2}
                            fill="transparent"
                            strokeDasharray="4 4"
                            activeDot={false}
                        />

                        <Area
                            type="monotone"
                            dataKey={walletDataKey}
                            name={viewMode === 'brl' ? 'walletBRL' : 'walletVal'}
                            stroke="#3B82F6"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorWallet)"
                            activeDot={{ r: 6, strokeWidth: 0, fill: '#60A5FA' }}
                        />

                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
});
