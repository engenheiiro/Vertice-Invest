
import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Header } from '../components/dashboard/Header';
import { researchService } from '../services/research';
import {
    Radar, ArrowLeft, CheckCircle2, XCircle, Clock, TrendingUp, TrendingDown,
    Minus, Target, Layers, Filter, Info, Shield, Activity, Zap, Medal
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PieChart as RechartsPie, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface QuantSignalHistory {
    _id: string;
    ticker: string;
    assetType: string;
    sector?: string;
    type: string;
    quality?: 'GOLD' | 'SILVER';
    urgencyLevel?: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    value?: number;
    message: string;
    timestamp: string;
    status: 'ACTIVE' | 'HIT' | 'MISS' | 'NEUTRAL';
    priceAtSignal?: number;
    finalPrice?: number;
    resultPercent?: number;
}

interface RadarMeta {
    lastScanAt: string | null;
    nextScanAt: string | null;
    assetsScanned: number;
    assetsWithHistory: number;
    activeSignalsTotal: number;
    scanIntervalMinutes: number;
}

interface AssetTypeAccuracy {
    winRate: number;
    totalSignals: number;
}

interface RadarStats {
    winRate: number;
    totalSignals: number;
    backtestHorizon: number;
    byAssetType?: { STOCK: AssetTypeAccuracy; FII: AssetTypeAccuracy; STOCK_US: AssetTypeAccuracy };
    heatmapClosed: { sector: string; value: number; avgReturn: number }[];
    heatmapOpen: { sector: string; value: number; avgReturn: number }[];
}

type StatusFilter = 'ALL' | 'HIT' | 'MISS' | 'NEUTRAL';
type AssetTypeFilter = 'ALL' | 'STOCK' | 'FII' | 'STOCK_US' | 'CRYPTO' | 'FIXED_INCOME';
type AccuracyFilter = 'ALL' | 'STOCK' | 'FII' | 'STOCK_US';

const getTypeLabel = (type: string) => {
    if (type === 'FII') return 'FII';
    if (type === 'STOCK_US') return 'Exterior';
    if (type === 'CRYPTO') return 'Cripto';
    if (type === 'FIXED_INCOME') return 'RF';
    return 'Ação';
};

const SECTOR_COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1', '#D4AF37', '#EF4444'
];

// ---------- Componentes locais reutilizados ----------

const ScanCountdown: React.FC<{ nextScanAt: string | null }> = ({ nextScanAt }) => {
    const [display, setDisplay] = useState('--:--');
    useEffect(() => {
        if (!nextScanAt) { setDisplay('--:--'); return; }
        const tick = () => {
            const diff = new Date(nextScanAt).getTime() - Date.now();
            if (diff <= 0) { setDisplay('atualizando...'); return; }
            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            setDisplay(`${mins}:${secs.toString().padStart(2, '0')}`);
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [nextScanAt]);
    return <span className="font-mono tabular-nums text-purple-400 font-bold">{display}</span>;
};

const FreshnessDot: React.FC<{ lastScanAt: string | null }> = ({ lastScanAt }) => {
    const [color, setColor] = useState('bg-slate-600');
    useEffect(() => {
        const update = () => {
            if (!lastScanAt) { setColor('bg-slate-600'); return; }
            const diffMs = Date.now() - new Date(lastScanAt).getTime();
            if (diffMs < 2 * 60 * 1000) setColor('bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.7)]');
            else if (diffMs < 10 * 60 * 1000) setColor('bg-yellow-400');
            else setColor('bg-slate-600');
        };
        update();
        const id = setInterval(update, 10000);
        return () => clearInterval(id);
    }, [lastScanAt]);
    return <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />;
};

const getUrgencyStyle = (level?: string) => {
    if (level === 'CRITICAL') return {
        border: 'border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.1)]',
        dot: 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]',
        badge: 'bg-red-500/15 text-red-400 border-red-500/30',
        label: 'CRÍTICO'
    };
    if (level === 'HIGH') return {
        border: 'border-orange-500/30',
        dot: 'bg-orange-400',
        badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
        label: 'ALTO'
    };
    return {
        border: 'border-slate-700',
        dot: 'bg-yellow-400',
        badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
        label: 'MÉDIO'
    };
};

const getRiskBadge = (profile?: string) => {
    if (profile === 'DEFENSIVE') return <span className="text-[9px] font-bold text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded border border-emerald-900/50 flex items-center gap-1"><Shield size={9} /> Defensivo</span>;
    if (profile === 'MODERATE') return <span className="text-[9px] font-bold text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded border border-blue-900/50 flex items-center gap-1"><Activity size={9} /> Moderado</span>;
    if (profile === 'BOLD') return <span className="text-[9px] font-bold text-purple-400 bg-purple-900/30 px-2 py-0.5 rounded border border-purple-900/50 flex items-center gap-1"><Zap size={9} /> Arrojado</span>;
    return null;
};

// Rótulo amigável do tipo de sinal (fallback: troca _ por espaço)
const signalTypeLabel = (type: string) => {
    if (type === 'RSI_OVERSOLD') return 'RSI Sobrevenda';
    if (type === 'DEEP_VALUE') return 'Deep Value';
    if (type === 'BULLISH_DIVERGENCE') return 'Divergência Altista';
    if (type === 'SUPPORT_ZONE') return 'Zona de Suporte';
    if (type === 'VOLUME_SPIKE') return 'Pico de Volume';
    return type.replace(/_/g, ' ');
};

const SignalValueTag: React.FC<{ type: string; value?: number }> = ({ type, value }) => {
    if (!value) return null;
    if (type === 'RSI_OVERSOLD' || type === 'BULLISH_DIVERGENCE') return (
        <span className="text-[9px] font-bold font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
            RSI {value.toFixed(0)}
        </span>
    );
    if (type === 'DEEP_VALUE') return (
        <span className="text-[9px] font-bold font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
            Graham R${value.toFixed(2)}
        </span>
    );
    return null;
};

// ---------- Página principal ----------

export const RadarPage = () => {
    const [signals, setSignals] = useState<QuantSignalHistory[]>([]);
    const [meta, setMeta] = useState<RadarMeta | null>(null);
    const { theme } = useTheme();
    const chartTooltipStyle = theme === 'light'
        ? { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', fontSize: '12px', color: '#0f172a' }
        : { backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px', color: '#fff' };
    const [stats, setStats] = useState<RadarStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [sectorView, setSectorView] = useState<'OPEN' | 'CLOSED'>('OPEN');
    const [assetTypeFilter, setAssetTypeFilter] = useState<AssetTypeFilter>('ALL');
    const [accuracyFilter, setAccuracyFilter] = useState<AccuracyFilter>('ALL');

    useEffect(() => {
        const load = async () => {
            try {
                const [historyData, statsData] = await Promise.all([
                    researchService.getSignalsHistory(),
                    researchService.getRadarStats()
                ]);
                setSignals(historyData.signals || []);
                setMeta(historyData.meta || null);
                setStats(statsData);
            } catch (e) {
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, []);

    const urgencyRank = (level?: string) => level === 'CRITICAL' ? 3 : level === 'HIGH' ? 2 : 1;

    const activeSignals = useMemo(() => {
        return signals
            .filter(s => {
                if (s.status !== 'ACTIVE') return false;
                if (assetTypeFilter !== 'ALL' && s.assetType !== assetTypeFilter) return false;
                return true;
            })
            .sort((a, b) => {
                const rankDiff = urgencyRank(b.urgencyLevel) - urgencyRank(a.urgencyLevel);
                if (rankDiff !== 0) return rankDiff;
                return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            });
    }, [signals, assetTypeFilter]);

    const closedSignals = useMemo(() => signals.filter(s => s.status !== 'ACTIVE'), [signals]);

    const filteredHistory = useMemo(() => {
        if (statusFilter === 'ALL') return closedSignals;
        return closedSignals.filter(s => s.status === statusFilter);
    }, [closedSignals, statusFilter]);

    const lastScanMinutesAgo = useMemo(() => {
        if (!meta?.lastScanAt) return null;
        const diff = Math.floor((Date.now() - new Date(meta.lastScanAt).getTime()) / 60000);
        return diff === 0 ? 'agora' : `há ${diff} min`;
    }, [meta?.lastScanAt]);

    const displayedAccuracy = useMemo(() => {
        if (!stats) return { winRate: 0, totalSignals: 0 };
        if (accuracyFilter === 'ALL') return { winRate: stats.winRate, totalSignals: stats.totalSignals };
        return stats.byAssetType?.[accuracyFilter] ?? { winRate: 0, totalSignals: 0 };
    }, [stats, accuracyFilter]);

    const pieData = [
        { name: 'Acertos', value: parseFloat(displayedAccuracy.winRate.toFixed(1)), color: '#34d399' },
        { name: 'Erros',   value: parseFloat((100 - displayedAccuracy.winRate).toFixed(1)), color: '#ef4444' }
    ];

    const activeHeatmapData = useMemo(() => {
        const source = sectorView === 'OPEN' ? (stats?.heatmapOpen || []) : (stats?.heatmapClosed || []);
        return source.map((item, i) => ({ ...item, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }));
    }, [stats, sectorView]);

    const getStatusBadge = (status: string) => {
        if (status === 'HIT') return <span className="flex items-center gap-1 text-emerald-400 bg-emerald-900/20 px-2 py-1 rounded border border-emerald-900/50 text-[10px] font-bold uppercase whitespace-nowrap"><CheckCircle2 size={11} /> Alvo</span>;
        if (status === 'MISS') return <span className="flex items-center gap-1 text-red-400 bg-red-900/20 px-2 py-1 rounded border border-red-900/50 text-[10px] font-bold uppercase whitespace-nowrap"><XCircle size={11} /> Stop</span>;
        if (status === 'NEUTRAL') return <span className="flex items-center gap-1 text-slate-400 bg-slate-800 px-2 py-1 rounded border border-slate-700 text-[10px] font-bold uppercase whitespace-nowrap"><Minus size={11} /> Expirado</span>;
        return <span className="flex items-center gap-1 text-blue-400 bg-blue-900/20 px-2 py-1 rounded border border-blue-900/50 text-[10px] font-bold uppercase whitespace-nowrap"><Clock size={11} /> Ativo</span>;
    };

    const formatCurrency = (val?: number) => val ? `R$ ${val.toFixed(2)}` : '-';

    return (
        <div className="min-h-screen bg-deep text-white font-sans selection:bg-blue-500/30">
            <Header />

            <main id="main-content" tabIndex={-1} className="max-w-[1200px] mx-auto p-4 md:p-6 animate-fade-in space-y-8">

                {/* ── Cabeçalho ── */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <Link to="/dashboard" className="text-xs font-bold text-slate-500 hover:text-white flex items-center gap-2 mb-2 transition-colors">
                            <ArrowLeft size={14} /> Voltar ao Terminal
                        </Link>
                        <h1 className="text-3xl font-black text-white flex items-center gap-3">
                            <Radar className="text-purple-500" size={32} />
                            Radar Alfa
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">
                            Scanner quantitativo · varredura a cada <span className="text-white font-bold">15 min</span> · {meta?.assetsScanned || '—'} ativos monitorados
                        </p>
                    </div>

                    {/* Status de scan */}
                    <div className="bg-base border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-3 shrink-0">
                        <FreshnessDot lastScanAt={meta?.lastScanAt || null} />
                        <div className="text-right">
                            <p className="text-[10px] text-slate-500 uppercase font-bold">Última varredura</p>
                            <p className="text-xs text-white font-mono">{lastScanMinutesAgo ?? '—'}</p>
                        </div>
                        <div className="w-px h-8 bg-slate-800" />
                        <div className="text-right">
                            <p className="text-[10px] text-slate-500 uppercase font-bold">Próxima em</p>
                            <ScanCountdown nextScanAt={meta?.nextScanAt || null} />
                        </div>
                    </div>
                </div>

                {/* ── Linha separadora ── */}
                <div className="flex items-center gap-4">
                    <div className="flex-1 h-px bg-slate-800" />
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Performance do Algoritmo</span>
                    <div className="flex-1 h-px bg-slate-800" />
                </div>

                {/* ── SEÇÃO 2: Regras de backtest ── */}
                <div className="bg-blue-900/10 border border-blue-900/30 rounded-xl p-4 flex items-start gap-3">
                    <Info size={18} className="text-blue-400 mt-0.5 shrink-0" />
                    <div>
                        <h4 className="text-xs font-bold text-blue-300 uppercase mb-1">Critérios de Saída Automática</h4>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            O sistema encerra a auditoria de um sinal quando um dos alvos é atingido:&nbsp;
                            <span className="text-emerald-400 font-bold">+3.5% Take Profit</span> &nbsp;|&nbsp;
                            <span className="text-red-400 font-bold">-3.5% Stop Loss</span> &nbsp;|&nbsp;
                            <span className="text-slate-300 font-bold">{stats?.backtestHorizon || 14} dias Time Stop</span>
                        </p>
                    </div>
                </div>

                {/* ── SEÇÃO 3: Estatísticas ── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Card win rate */}
                    <div className="bg-base border border-slate-800 rounded-2xl p-5 flex flex-col">
                        <div className="flex justify-between items-start mb-3">
                            <div>
                                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                    <Target size={16} className="text-emerald-500" /> Taxa de Acerto
                                </h3>
                                <p className="text-[10px] text-slate-500">Últimos 30 dias · sinais fechados</p>
                            </div>
                            <span className="text-2xl font-black text-white">
                                {displayedAccuracy.winRate > 0 ? `${displayedAccuracy.winRate}%` : '—'}
                            </span>
                        </div>

                        {/* Abas de filtro por tipo */}
                        <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800 mb-3 gap-px">
                            {([
                                ['ALL',      'Todos'],
                                ['STOCK',    'Ações BR'],
                                ['FII',      'FIIs'],
                                ['STOCK_US', 'Exterior'],
                            ] as [AccuracyFilter, string][]).map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() => setAccuracyFilter(key)}
                                    className={`flex-1 py-1 text-[9px] font-bold rounded transition-all truncate ${
                                        accuracyFilter === key
                                            ? 'bg-slate-700 text-white'
                                            : 'text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        <div className="h-28 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <RechartsPie>
                                    <Pie data={pieData} dataKey="value" innerRadius={25} outerRadius={42} paddingAngle={4} stroke="none">
                                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
                                    </Pie>
                                </RechartsPie>
                            </ResponsiveContainer>
                        </div>
                        <p className="text-center text-[10px] text-slate-500 mt-[-14px]">
                            Base: {displayedAccuracy.totalSignals} sinais
                        </p>
                    </div>

                    {/* Card concentração setorial */}
                    <div className="md:col-span-2 bg-base border border-slate-800 rounded-2xl p-5 flex flex-col">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                    <Layers size={16} className="text-blue-500" /> Concentração Setorial
                                </h3>
                                <p className="text-[10px] text-slate-500">Distribuição de sinais por segmento.</p>
                            </div>
                            <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                                <button onClick={() => setSectorView('OPEN')} className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${sectorView === 'OPEN' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Em Aberto</button>
                                <button onClick={() => setSectorView('CLOSED')} className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${sectorView === 'CLOSED' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Fechados</button>
                            </div>
                        </div>
                        <div className="flex-1 w-full min-h-[160px] flex items-center">
                            {activeHeatmapData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <RechartsPie>
                                        <Pie data={activeHeatmapData} dataKey="value" nameKey="sector" cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={2} stroke="none">
                                            {activeHeatmapData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={chartTooltipStyle}
                                            formatter={(value: any, name: any, props: any) => [
                                                `${value} Sinais${sectorView === 'CLOSED' ? ` · Ret: ${props.payload.avgReturn}%` : ''}`,
                                                name
                                            ]}
                                        />
                                        <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '10px', color: '#94a3b8' }} />
                                    </RechartsPie>
                                </ResponsiveContainer>
                            ) : (
                                <p className="w-full text-center text-xs text-slate-600 italic">Sem dados suficientes para este filtro.</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── SEÇÃO 1: Oportunidades Ativas ── */}
                <section>
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                        <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
                            Oportunidades Ativas
                        </h2>
                        <span className="text-xs font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
                            {activeSignals.length} {activeSignals.length === 1 ? 'sinal' : 'sinais'}
                        </span>

                        {/* Filtro tipo de ativo */}
                        <div className="flex flex-wrap bg-slate-900 p-0.5 rounded-lg border border-slate-800 ml-auto gap-px">
                            {([
                                ['ALL',          'Todos',      'bg-slate-700 text-white'],
                                ['STOCK',        'Ações BR',   'bg-blue-900/50 text-blue-400'],
                                ['FII',          'FIIs',       'bg-emerald-900/50 text-emerald-400'],
                                ['STOCK_US',     'Exterior',   'bg-indigo-900/50 text-indigo-400'],
                                ['CRYPTO',       'Cripto',     'bg-orange-900/50 text-orange-400'],
                                ['FIXED_INCOME', 'Renda Fixa', 'bg-yellow-900/50 text-yellow-400'],
                            ] as [AssetTypeFilter, string, string][]).map(([t, label, activeClass]) => (
                                <button
                                    key={t}
                                    onClick={() => setAssetTypeFilter(t)}
                                    className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${assetTypeFilter === t ? activeClass : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Qualidade fixa: apenas GOLD */}
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold border bg-gold/10 text-gold border-gold/30">
                            <Medal size={10} /> Apenas GOLD
                        </span>
                    </div>

                    {isLoading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {[...Array(3)].map((_, i) => (
                                <div key={i} className="h-40 rounded-2xl bg-base border border-slate-800 animate-pulse" />
                            ))}
                        </div>
                    ) : activeSignals.length === 0 ? (
                        <div className="bg-base border border-slate-800 rounded-2xl p-10 text-center">
                            <Radar size={40} className="text-slate-700 mx-auto mb-3" />
                            <p className="text-sm font-bold text-slate-500">Nenhuma anomalia detectada no momento.</p>
                            <p className="text-xs text-slate-600 mt-1.5 flex items-center justify-center gap-1">
                                <Clock size={11} /> Próxima varredura em <ScanCountdown nextScanAt={meta?.nextScanAt || null} />
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {activeSignals.map(signal => {
                                const urgency = getUrgencyStyle(signal.urgencyLevel);
                                const resultNow = signal.resultPercent;

                                return (
                                    <div
                                        key={signal._id}
                                        className={`bg-card border rounded-2xl p-4 flex flex-col gap-3 transition-all ${urgency.border}`}
                                    >
                                        {/* Linha 1: ticker + qualidade */}
                                        <div className="flex items-start justify-between">
                                            <div className="flex flex-col gap-1.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className={`w-2 h-2 rounded-full shrink-0 ${urgency.dot}`} />
                                                    <span className="font-black text-lg text-white tracking-wide">{signal.ticker}</span>
                                                    <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded uppercase">
                                                        {getTypeLabel(signal.assetType)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase ${urgency.badge}`}>
                                                        {urgency.label}
                                                    </span>
                                                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded border uppercase flex items-center gap-0.5 bg-gold/10 text-gold border-gold/30">
                                                        <Medal size={9} /> Ouro
                                                    </span>
                                                    <SignalValueTag type={signal.type} value={signal.value} />
                                                </div>
                                            </div>

                                            {/* Resultado parcial */}
                                            {resultNow !== undefined && (
                                                <div className={`text-right ${resultNow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    <p className="text-xs font-black">{resultNow > 0 ? '+' : ''}{resultNow.toFixed(2)}%</p>
                                                    <p className="text-[9px] text-slate-500">parcial</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Mensagem */}
                                        <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-800/50 pt-2">
                                            {signal.message}
                                        </p>

                                        {/* Rodapé */}
                                        <div className="flex items-center justify-between pt-1 border-t border-slate-800/50">
                                            <div className="flex items-center gap-1.5">
                                                {getRiskBadge((signal as any).riskProfile)}
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[9px] text-slate-600 font-mono">
                                                    {signal.sector || '—'}
                                                </p>
                                                <p className="text-[9px] text-slate-600 font-mono">
                                                    entrada {formatCurrency(signal.priceAtSignal)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* ── SEÇÃO 4: Histórico (sinais fechados) ── */}
                <section>
                    <div className="flex items-center gap-3 mb-4 flex-wrap">
                        <h2 className="text-sm font-black text-white uppercase tracking-wider">Histórico de Sinais</h2>
                        <div className="flex items-center gap-1.5">
                            <Filter size={12} className="text-slate-500" />
                            {(['ALL', 'HIT', 'MISS', 'NEUTRAL'] as StatusFilter[]).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setStatusFilter(f)}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                                        statusFilter === f
                                            ? f === 'HIT' ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-900'
                                            : f === 'MISS' ? 'bg-red-900/50 text-red-400 border border-red-900'
                                            : f === 'NEUTRAL' ? 'bg-slate-700/50 text-slate-400 border border-slate-700'
                                            : 'bg-slate-700 text-white'
                                            : 'text-slate-500 hover:text-white hover:bg-slate-800'
                                    }`}
                                >
                                    {f === 'ALL' ? 'Tudo' : f === 'HIT' ? 'Hits' : f === 'MISS' ? 'Stops' : 'Expirados'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[860px]">
                                <thead>
                                    <tr className="bg-card border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                        <th scope="col" className="p-4">Data</th>
                                        <th scope="col" className="p-4">Ativo</th>
                                        <th scope="col" className="p-4">Sinal</th>
                                        <th scope="col" className="p-4">Setor</th>
                                        <th scope="col" className="p-4 text-right">Entrada</th>
                                        <th scope="col" className="p-4 text-right">Saída</th>
                                        <th scope="col" className="p-4 text-right">Resultado</th>
                                        <th scope="col" className="p-4 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50 text-xs text-slate-300 font-medium">
                                    {isLoading ? (
                                        <tr><td colSpan={8} className="p-8 text-center text-slate-500">Carregando histórico...</td></tr>
                                    ) : filteredHistory.length === 0 ? (
                                        <tr><td colSpan={8} className="p-8 text-center text-slate-600">Nenhum registro encontrado.</td></tr>
                                    ) : (
                                        filteredHistory.map(signal => (
                                            <tr key={signal._id} className="hover:bg-slate-900/30 transition-colors">
                                                <td className="p-4 text-slate-500 font-mono text-[11px]">
                                                    {new Date(signal.timestamp).toLocaleDateString('pt-BR')}
                                                    <br />
                                                    <span className="text-[9px]">{new Date(signal.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                                </td>
                                                <td className="p-4">
                                                    <div className="font-bold text-white">{signal.ticker}</div>
                                                    <div className="text-[9px] text-slate-500 uppercase">{getTypeLabel(signal.assetType)}</div>
                                                </td>
                                                <td className="p-4">
                                                    <span className="block font-bold text-slate-200 text-[11px]">
                                                        {signalTypeLabel(signal.type)}
                                                    </span>
                                                    {signal.urgencyLevel && (
                                                        <span className={`text-[8px] font-bold px-1 py-0.5 rounded border ${getUrgencyStyle(signal.urgencyLevel).badge}`}>
                                                            {getUrgencyStyle(signal.urgencyLevel).label}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-4 text-slate-500 text-[11px]">{signal.sector || '—'}</td>
                                                <td className="p-4 text-right font-mono text-[11px]">{formatCurrency(signal.priceAtSignal)}</td>
                                                <td className="p-4 text-right font-mono text-[11px]">{formatCurrency(signal.finalPrice)}</td>
                                                <td className="p-4 text-right">
                                                    {signal.resultPercent !== undefined ? (
                                                        <span className={`font-bold flex items-center justify-end gap-1 ${signal.resultPercent > 0 ? 'text-emerald-400' : signal.resultPercent < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                                            {signal.resultPercent > 0 ? <TrendingUp size={11} /> : signal.resultPercent < 0 ? <TrendingDown size={11} /> : <Minus size={11} />}
                                                            {signal.resultPercent > 0 ? '+' : ''}{signal.resultPercent.toFixed(2)}%
                                                        </span>
                                                    ) : <span className="text-slate-700">—</span>}
                                                </td>
                                                <td className="p-4 text-center">
                                                    <div className="flex justify-center">{getStatusBadge(signal.status)}</div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
};
