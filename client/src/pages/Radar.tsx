
import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '../components/dashboard/Header';
import { researchService } from '../services/research';
import { Radar, ArrowLeft, CheckCircle2, XCircle, Clock, TrendingUp, TrendingDown, Minus, Target, PieChart, Filter } from 'lucide-react';
// @ts-ignore
import { Link } from 'react-router-dom';
import { PieChart as RechartsPie, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts';

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
    heatmap: { sector: string; hits: number; avgReturn: number }[];
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'HIT' | 'MISS';

export const RadarPage = () => {
    const [signals, setSignals] = useState<QuantSignalHistory[]>([]);
    const [stats, setStats] = useState<RadarStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    
    // Novo Estado de Filtro
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

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

    // Lógica de Filtragem no Cliente
    const filteredSignals = useMemo(() => {
        if (statusFilter === 'ALL') return signals;
        return signals.filter(s => s.status === statusFilter);
    }, [signals, statusFilter]);

    const getStatusBadge = (status: string) => {
        if (status === 'HIT') return <span className="flex items-center gap-1 text-emerald-400 bg-emerald-900/20 px-2 py-1 rounded border border-emerald-900/50 text-[10px] font-bold uppercase"><CheckCircle2 size={12}/> Sucesso</span>;
        if (status === 'MISS') return <span className="flex items-center gap-1 text-red-400 bg-red-900/20 px-2 py-1 rounded border border-red-900/50 text-[10px] font-bold uppercase"><XCircle size={12}/> Stop</span>;
        if (status === 'NEUTRAL') return <span className="flex items-center gap-1 text-slate-400 bg-slate-800 px-2 py-1 rounded border border-slate-700 text-[10px] font-bold uppercase"><Minus size={12}/> Lateral</span>;
        return <span className="flex items-center gap-1 text-blue-400 bg-blue-900/20 px-2 py-1 rounded border border-blue-900/50 text-[10px] font-bold uppercase"><Clock size={12}/> Aberto</span>;
    };

    const formatCurrency = (val?: number) => val ? `R$ ${val.toFixed(2)}` : '-';

    // Gráfico de Pizza (Win Rate)
    const pieData = stats ? [
        { name: 'Acertos (Hits)', value: stats.winRate, color: '#34d399' },
        { name: 'Erros/Neutros', value: 100 - stats.winRate, color: '#ef4444' }
    ] : [];

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

                    {/* CARD 2: HEATMAP SETORIAL */}
                    <div className="md:col-span-2 bg-[#080C14] border border-slate-800 rounded-2xl p-5">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                    <PieChart size={16} className="text-blue-500" /> Setores Quentes
                                </h3>
                                <p className="text-[10px] text-slate-500">Onde o algoritmo está encontrando mais Alpha.</p>
                            </div>
                        </div>
                        <div className="h-32 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats?.heatmap || []} layout="vertical" margin={{ top: 0, right: 30, left: 40, bottom: 0 }}>
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="sector" type="category" width={80} tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                                    <Tooltip 
                                        cursor={{fill: 'transparent'}}
                                        contentStyle={{ backgroundColor: '#0F1729', borderColor: '#1e293b', borderRadius: '8px', fontSize: '10px' }}
                                    />
                                    <Bar dataKey="hits" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={15}>
                                        {stats?.heatmap.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.avgReturn > 0 ? '#10b981' : '#ef4444'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
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
                                    <th className="p-4 text-right">Resultado</th>
                                    <th className="p-4 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50 text-xs text-slate-300 font-medium">
                                {isLoading ? (
                                    <tr><td colSpan={8} className="p-8 text-center text-slate-500">Carregando histórico...</td></tr>
                                ) : filteredSignals.length === 0 ? (
                                    <tr><td colSpan={8} className="p-8 text-center text-slate-500">Nenhum registro encontrado para este filtro.</td></tr>
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
                                            <td className="p-4 max-w-xs truncate" title={signal.message}>
                                                <span className="block font-bold text-slate-200 mb-0.5">{signal.type.replace('_', ' ')}</span>
                                                <span className="text-slate-500">{signal.message}</span>
                                            </td>
                                            <td className="p-4 text-right font-mono">
                                                {formatCurrency(signal.priceAtSignal)}
                                            </td>
                                            <td className="p-4 text-right font-mono">
                                                {/* Preço de fechamento ou preço atual live se estiver ativo */}
                                                {formatCurrency(signal.finalPrice)}
                                            </td>
                                            <td className="p-4 text-right">
                                                {signal.resultPercent !== undefined ? (
                                                    <span className={`font-bold flex items-center justify-end gap-1 ${signal.resultPercent > 0 ? 'text-emerald-400' : signal.resultPercent < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                                        {signal.resultPercent > 0 ? <TrendingUp size={12}/> : signal.resultPercent < 0 ? <TrendingDown size={12}/> : <Minus size={12}/>}
                                                        {signal.resultPercent.toFixed(2)}%
                                                    </span>
                                                ) : <span className="text-slate-600">-</span>}
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
