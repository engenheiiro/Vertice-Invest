
import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '../components/dashboard/Header';
import { researchService } from '../services/research';
import { Radar, ArrowLeft, CheckCircle2, XCircle, Clock, TrendingUp, TrendingDown, Minus, Target, PieChart, Filter, Info, Layers } from 'lucide-react';
// @ts-ignore
import { Link } from 'react-router-dom';
import { PieChart as RechartsPie, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface QuantSignalHistory {
    _id: string;
    ticker: string;
    assetType: string;
    type: string;
    message: string;
    timestamp: string;
    status: 'ACTIVE' | 'HIT' | 'MISS' | 'NEUTRAL';
    priceAtSignal?: number;
    finalPrice?: number;
    resultPercent?: number;
}

interface RadarStats {
    winRate: number;
    totalSignals: number;
    backtestHorizon: number;
    heatmapClosed: { sector: string; value: number; avgReturn: number }[];
    heatmapOpen: { sector: string; value: number; avgReturn: number }[];
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'HIT' | 'MISS';

const SECTOR_COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1', '#D4AF37', '#EF4444'
];

export const RadarPage = () => {
    const [signals, setSignals] = useState<QuantSignalHistory[]>([]);
    const [stats, setStats] = useState<RadarStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [sectorView, setSectorView] = useState<'OPEN' | 'CLOSED'>('OPEN');

    useEffect(() => {
        const fetch = async () => {
            try {
                const [data, statsData] = await Promise.all([
                    researchService.getSignalsHistory(),
                    researchService.getRadarStats()
                ]);
                setSignals(data);
                setStats(statsData);
            } catch (e) {
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        };
        fetch();
    }, []);

    const filteredSignals = useMemo(() => {
        if (statusFilter === 'ALL') return signals;
        return signals.filter(s => s.status === statusFilter);
    }, [signals, statusFilter]);

    const getStatusBadge = (status: string) => {
        if (status === 'HIT') return <span className="flex items-center gap-1 text-emerald-400 bg-emerald-900/20 px-2 py-1 rounded border border-emerald-900/50 text-[10px] font-bold uppercase whitespace-nowrap"><CheckCircle2 size={12}/> Alvo Atingido</span>;
        if (status === 'MISS') return <span className="flex items-center gap-1 text-red-400 bg-red-900/20 px-2 py-1 rounded border border-red-900/50 text-[10px] font-bold uppercase whitespace-nowrap"><XCircle size={12}/> Stop Loss</span>;
        if (status === 'NEUTRAL') return <span className="flex items-center gap-1 text-slate-400 bg-slate-800 px-2 py-1 rounded border border-slate-700 text-[10px] font-bold uppercase whitespace-nowrap"><Minus size={12}/> Expirado</span>;
        return <span className="flex items-center gap-1 text-blue-400 bg-blue-900/20 px-2 py-1 rounded border border-blue-900/50 text-[10px] font-bold uppercase whitespace-nowrap"><Clock size={12}/> Em Andamento</span>;
    };

    const formatCurrency = (val?: number) => val ? `R$ ${val.toFixed(2)}` : '-';

    // Gráfico de Pizza (Win Rate)
    const pieData = stats ? [
        { name: 'Acertos (Hits)', value: stats.winRate, color: '#34d399' },
        { name: 'Erros/Neutros', value: 100 - stats.winRate, color: '#ef4444' }
    ] : [];

    // Dados do Gráfico de Setores (Pizza)
    const activeHeatmapData = useMemo(() => {
        const source = sectorView === 'OPEN' ? (stats?.heatmapOpen || []) : (stats?.heatmapClosed || []);
        return source.map((item, index) => ({
            ...item,
            color: SECTOR_COLORS[index % SECTOR_COLORS.length]
        }));
    }, [stats, sectorView]);

    return (
        <div className="min-h-screen bg-[#02040a] text-white font-sans selection:bg-blue-500/30">
            <Header />
            
            <main className="max-w-[1200px] mx-auto p-6 animate-fade-in">
                <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <Link to="/dashboard" className="text-xs font-bold text-slate-500 hover:text-white flex items-center gap-2 mb-2 transition-colors">
                            <ArrowLeft size={14} /> Voltar ao Terminal
                        </Link>
                        <h1 className="text-3xl font-black text-white flex items-center gap-3">
                            <Radar className="text-purple-500" size={32} />
                            Inteligência Radar Alpha
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">
                            Auditoria Quantitativa. Horizonte de validação: <span className="text-white font-bold">{stats?.backtestHorizon || 7} dias</span>.
                        </p>
                    </div>
                </div>

                {/* --- REGRAS DO MOTOR --- */}
                <div className="bg-blue-900/10 border border-blue-900/30 rounded-xl p-4 mb-8 flex items-start gap-3">
                    <Info size={18} className="text-blue-400 mt-0.5 shrink-0" />
                    <div>
                        <h4 className="text-xs font-bold text-blue-300 uppercase mb-1">Critérios de Saída Automática (Backtest)</h4>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            O sistema encerra automaticamente a auditoria de um sinal quando um dos alvos é atingido:
                            <br/>
                            <span className="text-emerald-400 font-bold">• Take Profit (Alvo): +3.0%</span> &nbsp;|&nbsp; 
                            <span className="text-red-400 font-bold">• Stop Loss (Proteção): -2.0%</span> &nbsp;|&nbsp; 
                            <span className="text-slate-300 font-bold">• Time Stop (Tempo): {stats?.backtestHorizon || 7} dias</span> (Fechamento neutro).
                        </p>
                    </div>
                </div>

                {/* --- ESTATÍSTICAS --- */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {/* CARD 1: PERFORMANCE */}
                    <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                    <Target size={16} className="text-emerald-500" /> Taxa de Acerto
                                </h3>
                                <p className="text-[10px] text-slate-500">Últimos 30 dias (Fechados)</p>
                            </div>
                            <span className="text-2xl font-black text-white">{stats?.winRate}%</span>
                        </div>
                        <div className="h-32 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <RechartsPie>
                                    <Pie
                                        data={pieData}
                                        dataKey="value"
                                        innerRadius={25}
                                        outerRadius={40}
                                        paddingAngle={5}
                                        stroke="none"
                                    >
                                        {pieData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                                        ))}
                                    </Pie>
                                </RechartsPie>
                            </ResponsiveContainer>
                        </div>
                        <div className="text-center text-[10px] text-slate-500 mt-[-20px]">
                            Base: {stats?.totalSignals || 0} sinais
                        </div>
                    </div>

                    {/* CARD 2: HEATMAP SETORIAL (PIE CHART) */}
                    <div className="md:col-span-2 bg-[#080C14] border border-slate-800 rounded-2xl p-5 flex flex-col">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                    <Layers size={16} className="text-blue-500" /> Concentração Setorial
                                </h3>
                                <p className="text-[10px] text-slate-500">Distribuição de sinais por segmento.</p>
                            </div>
                            
                            {/* TOGGLE VIEW */}
                            <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                                <button 
                                    onClick={() => setSectorView('OPEN')}
                                    className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${sectorView === 'OPEN' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    Em Aberto
                                </button>
                                <button 
                                    onClick={() => setSectorView('CLOSED')}
                                    className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${sectorView === 'CLOSED' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    Fechados (Hits)
                                </button>
                            </div>
                        </div>
                        
                        <div className="flex-1 w-full min-h-[160px] flex items-center">
                            {activeHeatmapData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <RechartsPie>
                                        <Pie
                                            data={activeHeatmapData}
                                            dataKey="value"
                                            nameKey="sector"
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={40}
                                            outerRadius={60}
                                            paddingAngle={2}
                                            stroke="none"
                                        >
                                            {activeHeatmapData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px', color: '#fff' }}
                                            itemStyle={{ color: '#fff' }}
                                            formatter={(value: any, name: any, props: any) => [
                                                `${value} Sinais ${sectorView === 'CLOSED' ? `(Ret: ${props.payload.avgReturn}%)` : ''}`, 
                                                name
                                            ]}
                                        />
                                        <Legend 
                                            layout="vertical" 
                                            verticalAlign="middle" 
                                            align="right"
                                            iconType="circle"
                                            iconSize={8}
                                            wrapperStyle={{ fontSize: '10px', color: '#94a3b8' }}
                                        />
                                    </RechartsPie>
                                </ResponsiveContainer>
                            ) : (
                                <div className="w-full text-center text-xs text-slate-600 italic">
                                    Sem dados suficientes para este filtro.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* --- FILTROS --- */}
                <div className="mb-4 flex items-center gap-2">
                    <Filter size={14} className="text-slate-500" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase mr-2">Filtrar Histórico:</span>
                    <button onClick={() => setStatusFilter('ALL')} className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${statusFilter === 'ALL' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}>Tudo</button>
                    <button onClick={() => setStatusFilter('ACTIVE')} className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${statusFilter === 'ACTIVE' ? 'bg-blue-900/50 text-blue-400 border border-blue-900' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}>Em Aberto</button>
                    <button onClick={() => setStatusFilter('HIT')} className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${statusFilter === 'HIT' ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-900' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}>Hits</button>
                    <button onClick={() => setStatusFilter('MISS')} className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${statusFilter === 'MISS' ? 'bg-red-900/50 text-red-400 border border-red-900' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}>Stops</button>
                </div>

                {/* --- TABELA --- */}
                <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[900px]">
                            <thead>
                                <tr className="bg-[#0B101A] border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                    <th className="p-4">Data</th>
                                    <th className="p-4">Ativo</th>
                                    <th className="p-4">Setor</th>
                                    <th className="p-4">Sinal</th>
                                    <th className="p-4 text-right">Entrada</th>
                                    <th className="p-4 text-right">Saída / Atual</th>
                                    <th className="p-4 text-right">Res. Parcial</th>
                                    <th className="p-4 text-right">Res. Final</th>
                                    <th className="p-4 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50 text-xs text-slate-300 font-medium">
                                {isLoading ? (
                                    <tr><td colSpan={9} className="p-8 text-center text-slate-500">Carregando histórico...</td></tr>
                                ) : filteredSignals.length === 0 ? (
                                    <tr><td colSpan={9} className="p-8 text-center text-slate-500">Nenhum registro encontrado para este filtro.</td></tr>
                                ) : (
                                    filteredSignals.map((signal) => (
                                        <tr key={signal._id} className="hover:bg-slate-900/30 transition-colors">
                                            <td className="p-4 text-slate-500 font-mono">
                                                {new Date(signal.timestamp).toLocaleDateString('pt-BR')} <br/>
                                                <span className="text-[9px]">{new Date(signal.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</span>
                                            </td>
                                            <td className="p-4">
                                                <div className="font-bold text-white text-sm">{signal.ticker}</div>
                                                <div className="text-[9px] text-slate-500 uppercase">{signal.assetType === 'FII' ? 'Fundo' : 'Ação'}</div>
                                            </td>
                                            <td className="p-4 text-slate-400">
                                                {(signal as any).sector || '-'}
                                            </td>
                                            <td className="p-4">
                                                <span className="block font-bold text-slate-200">{signal.type.replace(/_/g, ' ')}</span>
                                            </td>
                                            <td className="p-4 text-right font-mono">
                                                {formatCurrency(signal.priceAtSignal)}
                                            </td>
                                            <td className="p-4 text-right font-mono">
                                                {formatCurrency(signal.finalPrice)}
                                            </td>
                                            
                                            <td className="p-4 text-right">
                                                {signal.status === 'ACTIVE' && signal.resultPercent !== undefined ? (
                                                    <span className={`font-bold ${
                                                        signal.resultPercent > 0 ? 'text-emerald-400' : 
                                                        signal.resultPercent < 0 ? 'text-red-400' : 
                                                        'text-slate-400'
                                                    }`}>
                                                        {signal.resultPercent > 0 ? '+' : ''}{signal.resultPercent.toFixed(2)}%
                                                    </span>
                                                ) : <span className="text-slate-700">-</span>}
                                            </td>

                                            <td className="p-4 text-right">
                                                {signal.status !== 'ACTIVE' && signal.resultPercent !== undefined ? (
                                                    <span className={`font-bold flex items-center justify-end gap-1 ${signal.resultPercent > 0 ? 'text-emerald-400' : signal.resultPercent < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                                        {signal.resultPercent > 0 ? <TrendingUp size={12}/> : signal.resultPercent < 0 ? <TrendingDown size={12}/> : <Minus size={12}/>}
                                                        {signal.resultPercent.toFixed(2)}%
                                                    </span>
                                                ) : <span className="text-slate-700">-</span>}
                                            </td>

                                            <td className="p-4 text-center">
                                                <div className="flex justify-center">
                                                    {getStatusBadge(signal.status)}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    );
};
