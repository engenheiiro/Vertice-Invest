import React, { useMemo, useState } from 'react';
import { TrendingUp, Minus, Trophy, BadgeAlert, BarChart2, PieChart, Layers, Info } from 'lucide-react';
import { RankingItem } from '../../services/research';
import { AssetDetailModal } from './AssetDetailModal';

interface TopPicksCardProps {
    picks: RankingItem[];
    assetClass: string;
}

const COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1', '#D4AF37',
    '#EF4444', '#84CC16', '#14B8A6', '#F97316', '#A855F7', '#0EA5E9'
];

export const TopPicksCard: React.FC<TopPicksCardProps> = ({ picks, assetClass }) => {
    const [selectedAsset, setSelectedAsset] = useState<RankingItem | null>(null);

    const sortedPicks = useMemo(() => {
        return [...picks].sort((a, b) => a.position - b.position);
    }, [picks]);

    const stats = useMemo(() => {
        if (!picks.length) return { avgScore: 0, avgDy: 0, count: 0 };
        const totalScore = picks.reduce((acc, curr) => acc + curr.score, 0);
        const totalDy = picks.reduce((acc, curr) => acc + (curr.metrics.dy || 0), 0);
        return {
            avgScore: Math.round(totalScore / picks.length),
            avgDy: (totalDy / picks.length).toFixed(2),
            count: picks.length
        };
    }, [picks]);

    const getScoreColor = (score: number) => {
        if (score >= 90) return 'bg-emerald-500';
        if (score >= 75) return 'bg-green-500';
        if (score >= 60) return 'bg-blue-500';
        if (score >= 50) return 'bg-yellow-500';
        if (score >= 30) return 'bg-orange-500';
        return 'bg-red-600';
    };

    const getScoreTextColor = (score: number) => {
        if (score >= 90) return 'text-emerald-400';
        if (score >= 75) return 'text-green-400';
        if (score >= 60) return 'text-blue-400';
        if (score >= 50) return 'text-yellow-400';
        if (score >= 30) return 'text-orange-400';
        return 'text-red-500';
    };

    const formatCurrency = (val: number) => {
        if (!val && val !== 0) return '-';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const getActionLabel = (action: string) => {
        if (action === 'BUY') return 'COMPRAR';
        if (action === 'WAIT') return 'AGUARDAR';
        if (action === 'SELL') return 'VENDER';
        return action;
    };

    const getActionColor = (action: string) => {
        if (action === 'BUY') return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        if (action === 'SELL') return 'text-red-500 bg-red-500/10 border-red-500/20';
        return 'text-blue-300 bg-blue-900/20 border-blue-800'; 
    };

    return (
        <div className="max-w-7xl mx-auto animate-fade-in space-y-6 pb-20">
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Resumo da Carteira (Lado Esquerdo - Maior) */}
                <div className="lg:col-span-8 bg-[#080C14] border border-slate-800 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between shadow-2xl min-h-[220px]">
                    <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
                        <Trophy size={100} className="text-white" />
                    </div>
                    
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 bg-blue-600/20 rounded-lg flex items-center justify-center border border-blue-600/30">
                                <BarChart2 size={16} className="text-blue-500" />
                            </div>
                            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-blue-900/10 px-2 py-0.5 rounded border border-blue-900/20">
                                IA Selection
                            </span>
                        </div>
                        <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight uppercase">
                            {assetClass === 'BRASIL_10' ? 'TOP 10 BRASIL' : assetClass.replace('_', ' ')}
                        </h2>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                        <div className="bg-[#0B101A] border border-slate-800 p-3 rounded-2xl">
                            <p className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">Score Médio</p>
                            <p className={`text-xl font-black ${getScoreTextColor(stats.avgScore)}`}>{stats.avgScore}<span className="text-xs text-slate-600">/100</span></p>
                        </div>
                        <div className="bg-[#0B101A] border border-slate-800 p-3 rounded-2xl">
                            <p className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">Yield 12m</p>
                            <p className="text-xl font-black text-emerald-400">{stats.avgDy}%</p>
                        </div>
                        <div className="bg-[#0B101A] border border-slate-800 p-3 rounded-2xl">
                            <p className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">Ativos</p>
                            <p className="text-xl font-black text-white">{stats.count}</p>
                        </div>
                         <div className="bg-blue-600/10 border border-blue-500/20 p-3 rounded-2xl flex items-center justify-center text-center">
                            <p className="text-[9px] text-blue-400 font-bold leading-tight">
                                <Info size={10} className="inline mr-1" />
                                Sugestão de Rebalanceamento
                            </p>
                        </div>
                    </div>
                </div>

                {/* Diversificação (Lado Direito - Compacto e Harmônico) */}
                <div className="lg:col-span-4 bg-[#080C14] border border-slate-800 rounded-3xl p-5 flex flex-col relative overflow-hidden h-full min-h-[220px]">
                    <div className="flex items-center gap-2 mb-3 relative z-10 shrink-0">
                        <PieChart size={14} className="text-purple-500" />
                        <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Diversificação</h3>
                    </div>
                    
                    <div className="flex-1 flex flex-row items-center gap-6 relative z-10 min-h-0">
                        <SectorDistribution picks={picks} />
                    </div>
                    
                    <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-purple-900/10 rounded-full blur-[50px]"></div>
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Layers size={12} /> Composição Detalhada
                    </h3>
                </div>

                {sortedPicks.map((pick, idx) => {
                    const isFII = pick.type === 'FII';
                    const fairValue = isFII 
                        ? pick.metrics?.bazinPrice 
                        : (pick.metrics?.grahamPrice || pick.metrics?.bazinPrice);
                    const fairValueLabel = isFII ? "Bazin" : (pick.metrics?.grahamPrice ? "Graham" : "Bazin");

                    return (
                        <div 
                            key={idx} 
                            onClick={() => setSelectedAsset(pick)}
                            className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 hover:border-slate-600 hover:bg-[#0F131E] transition-all cursor-pointer group relative overflow-hidden"
                        >
                            <div className="flex flex-col md:flex-row gap-6 items-center">
                                <div className="flex items-center gap-4 flex-1 w-full">
                                    <div className={`w-8 h-8 flex items-center justify-center rounded-lg font-black text-sm border ${
                                        idx === 0 ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30' : 
                                        'bg-slate-900 text-slate-600 border-slate-800'
                                    }`}>
                                        {pick.position}
                                    </div>
                                    
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-base font-black text-white tracking-tight">{pick.ticker}</h4>
                                            <span className="hidden sm:inline-block text-[8px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-bold uppercase border border-slate-700">
                                                {pick.sector || 'Geral'}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 font-medium truncate">
                                            {pick.name}
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full md:w-auto md:flex-[2.5]">
                                    <div className="text-center md:text-left">
                                        <p className="text-[8px] font-bold text-slate-500 uppercase">Atual</p>
                                        <p className="text-xs font-bold text-slate-300 font-mono">{formatCurrency(pick.currentPrice)}</p>
                                    </div>
                                    <div className="text-center md:text-left">
                                        <p className="text-[8px] font-bold text-slate-500 uppercase">Teto ({fairValueLabel})</p>
                                        <p className="text-xs font-bold text-white font-mono">{formatCurrency(fairValue || 0)}</p>
                                    </div>
                                    <div className="text-center md:text-left">
                                        <p className="text-[8px] font-bold text-slate-500 uppercase">Yield</p>
                                        <p className="text-xs font-bold text-emerald-400 font-mono">{pick.metrics?.dy ? `${pick.metrics.dy.toFixed(1)}%` : '-'}</p>
                                    </div>
                                    <div className="text-center md:text-left">
                                        <p className="text-[8px] font-bold text-slate-500 uppercase">E. Yield</p>
                                        <p className="text-xs font-bold text-blue-400 font-mono">{pick.metrics?.earningsYield ? `${pick.metrics.earningsYield.toFixed(1)}%` : '-'}</p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between w-full md:w-auto gap-4 border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
                                    <div className="flex-1 md:w-24">
                                        <div className="flex justify-between text-[8px] font-black mb-1 uppercase">
                                            <span className="text-slate-500">IA</span>
                                            <span className={getScoreTextColor(pick.score)}>{pick.score}</span>
                                        </div>
                                        <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full transition-all duration-700 ${getScoreColor(pick.score)}`} style={{ width: `${pick.score}%` }}></div>
                                        </div>
                                    </div>

                                    <div className={`px-3 py-1.5 rounded-lg border flex flex-col items-center min-w-[80px] ${getActionColor(pick.action)}`}>
                                        <span className="text-[9px] font-black tracking-tighter">{getActionLabel(pick.action)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center justify-center gap-2 text-[9px] text-slate-600 font-bold uppercase tracking-widest mt-8 py-4 border-t border-slate-800/30">
                <BadgeAlert size={12} />
                Dados Yahoo Finance tratados algoritmicamente pela Vértice AI
            </div>

            <AssetDetailModal 
                isOpen={!!selectedAsset} 
                onClose={() => setSelectedAsset(null)} 
                asset={selectedAsset} 
            />
        </div>
    );
};

// Componente de Gráfico de Setores (Otimizado para Harmonia Lateral)
const SectorDistribution = ({ picks }: { picks: RankingItem[] }) => {
    const sectors = useMemo(() => {
        const counts: Record<string, number> = {};
        picks.forEach(p => {
            const s = p.sector || 'Outros';
            counts[s] = (counts[s] || 0) + 1;
        });
        
        return Object.entries(counts)
            .map(([name, count]) => ({ name, count, percent: (count / picks.length) * 100 }))
            .sort((a, b) => b.count - a.count);
    }, [picks]);

    let cumulativePercent = 0;
    if (sectors.length === 0) return <p className="text-[10px] text-slate-500">Sem dados.</p>;

    return (
        <div className="flex flex-row items-center gap-6 w-full h-full justify-start">
            {/* Gráfico Donut */}
            <div className="relative w-20 h-20 shrink-0">
                <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1e293b" strokeWidth="6"></circle>
                    {sectors.map((sector, i) => {
                        const dash = `${sector.percent} ${100 - sector.percent}`;
                        const offset = 100 - cumulativePercent + 25;
                        cumulativePercent += sector.percent;
                        return (
                            <circle 
                                key={sector.name}
                                cx="21" cy="21" r="15.91549430918954" 
                                fill="transparent" 
                                stroke={COLORS[i % COLORS.length]} 
                                strokeWidth="6"
                                strokeDasharray={dash}
                                strokeDashoffset={offset}
                                className="transition-all duration-1000 ease-out"
                            ></circle>
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] font-black text-white">{picks.length}</span>
                    <span className="text-[7px] text-slate-500 uppercase font-bold">Total</span>
                </div>
            </div>

            {/* Legenda Lateral Compacta */}
            <div className="flex-1 space-y-2 overflow-y-auto max-h-[120px] custom-scrollbar pr-1">
                {sectors.map((sector, i) => (
                    <div key={sector.name} className="flex items-center justify-between text-[9px] group">
                        <div className="flex items-center gap-2 overflow-hidden">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                            <span className="text-slate-400 truncate max-w-[80px] group-hover:text-slate-200 transition-colors" title={sector.name}>{sector.name}</span>
                        </div>
                        <span className="font-bold text-slate-300 font-mono ml-2">{Math.round(sector.percent)}%</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
