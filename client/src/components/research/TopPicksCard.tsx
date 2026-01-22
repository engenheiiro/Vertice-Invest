
import React, { useMemo, useState } from 'react';
import { TrendingUp, Minus, Trophy, BadgeAlert, Target, BarChart2, MousePointerClick } from 'lucide-react';
import { RankingItem } from '../../services/research';
import { AssetDetailModal } from './AssetDetailModal';

interface TopPicksCardProps {
    picks: RankingItem[];
    assetClass: string;
}

export const TopPicksCard: React.FC<TopPicksCardProps> = ({ picks, assetClass }) => {
    const [selectedAsset, setSelectedAsset] = useState<RankingItem | null>(null);

    // Ordenação garantida pelo backend, mas reforçamos aqui
    const sortedPicks = useMemo(() => {
        return [...picks].sort((a, b) => a.position - b.position);
    }, [picks]);

    const formatCurrency = (val: number) => {
        if (!val) return 'N/A';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const getActionColor = (action: string) => {
        if (action === 'BUY') return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        if (action === 'SELL') return 'text-red-500 bg-red-500/10 border-red-500/20';
        return 'text-slate-400 bg-slate-800 border-slate-700';
    };

    const getThesisColor = (thesis?: string) => {
        const t = thesis?.toUpperCase() || '';
        if (t.includes('DIVIDEND')) return 'text-cyan-400 bg-cyan-900/20 border-cyan-800';
        if (t.includes('VALOR') || t.includes('VALUE')) return 'text-blue-400 bg-blue-900/20 border-blue-800';
        if (t.includes('CRESCIMENTO') || t.includes('GROWTH')) return 'text-purple-400 bg-purple-900/20 border-purple-800';
        if (t.includes('RISCO') || t.includes('TURNAROUND')) return 'text-orange-400 bg-orange-900/20 border-orange-800';
        return 'text-slate-400 bg-slate-800 border-slate-700';
    };

    return (
        <div className="max-w-6xl mx-auto animate-fade-in space-y-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-[#D4AF37]/10 rounded-xl flex items-center justify-center border border-[#D4AF37]/20 shadow-[0_0_15px_rgba(212,175,55,0.1)]">
                        <Trophy className="text-[#D4AF37]" size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-white tracking-tight uppercase">
                            Ranking Alpha: {assetClass.replace('_', ' ')}
                        </h2>
                        <p className="text-slate-500 text-xs font-medium flex items-center gap-2">
                            <BarChart2 size={12} />
                            Análise Quantitativa + IA Neural
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid gap-4">
                {sortedPicks.map((pick, idx) => {
                    const probability = pick.probability || 50;
                    
                    return (
                        <div 
                            key={idx} 
                            onClick={() => setSelectedAsset(pick)}
                            className="bg-[#080C14] border border-slate-800 rounded-2xl p-5 hover:border-slate-600 hover:bg-[#0B101A] transition-all cursor-pointer group relative overflow-hidden"
                        >
                            {/* Destaque dourado para o Top 1 */}
                            {idx === 0 && <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#D4AF37] via-yellow-500 to-[#D4AF37]"></div>}

                            <div className="flex flex-col lg:flex-row gap-6">
                                
                                <div className="flex-1 min-w-[200px]">
                                    <div className="flex items-center gap-4 mb-3">
                                        <span className={`text-2xl font-black italic w-8 text-center ${
                                            idx === 0 ? 'text-[#D4AF37]' : 
                                            idx === 1 ? 'text-slate-300' : 
                                            idx === 2 ? 'text-orange-400' : 'text-slate-600'
                                        }`}>
                                            #{pick.position}
                                        </span>
                                        <div>
                                            <h4 className="text-xl font-black text-white tracking-tight flex items-center gap-2 group-hover:text-blue-400 transition-colors">
                                                {pick.ticker}
                                                {pick.thesis && (
                                                    <span className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${getThesisColor(pick.thesis)}`}>
                                                        {pick.thesis}
                                                    </span>
                                                )}
                                            </h4>
                                            <span className="text-[10px] text-slate-500 font-bold uppercase">{pick.name || pick.ticker}</span>
                                        </div>
                                    </div>
                                    
                                    <p className="text-sm text-slate-300 font-medium leading-relaxed border-l-2 border-slate-800 pl-3 ml-2 line-clamp-2">
                                        "{pick.reason}"
                                    </p>
                                </div>

                                <div className="flex items-center justify-between lg:justify-end gap-4 lg:gap-8 border-t lg:border-t-0 border-slate-800/50 pt-4 lg:pt-0">
                                    
                                    <div className="flex flex-col items-center w-20">
                                        <span className="text-[9px] font-bold text-slate-500 uppercase mb-1">Score</span>
                                        <div className="relative flex items-center justify-center">
                                            <svg className="w-12 h-12 transform -rotate-90">
                                                <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-slate-800" />
                                                <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" 
                                                    className={pick.score > 80 ? 'text-blue-500' : pick.score > 60 ? 'text-yellow-500' : 'text-slate-500'}
                                                    strokeDasharray={125.6}
                                                    strokeDashoffset={125.6 - (125.6 * pick.score) / 100}
                                                />
                                            </svg>
                                            <span className="absolute text-xs font-bold text-white">{pick.score}</span>
                                        </div>
                                    </div>

                                    <div className="w-24">
                                        <div className="flex justify-between text-[9px] font-bold mb-1 uppercase text-slate-500">
                                            <span>Prob.</span>
                                            <span className="text-emerald-400">{probability}%</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                                                style={{ width: `${probability}%` }}
                                            ></div>
                                        </div>
                                    </div>

                                    <div className="text-right min-w-[100px]">
                                        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded mb-1 text-[10px] font-black uppercase border ${getActionColor(pick.action)}`}>
                                            {pick.action === 'BUY' && <TrendingUp size={12} />}
                                            {pick.action === 'WAIT' && <Minus size={12} />}
                                            {pick.action === 'SELL' && <TrendingUp size={12} className="rotate-180" />}
                                            {pick.action}
                                        </div>
                                        <div>
                                            <p className="text-[9px] text-slate-500 uppercase font-bold flex items-center justify-end gap-1">
                                                <Target size={10} /> Alvo
                                            </p>
                                            <p className="text-lg font-bold text-white font-mono">{formatCurrency(pick.targetPrice)}</p>
                                        </div>
                                    </div>

                                </div>
                            </div>
                            
                            {/* Hover Indicator */}
                            <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-blue-500 font-bold uppercase tracking-widest flex items-center gap-1">
                                <MousePointerClick size={12} /> Ver Detalhes
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center justify-center gap-2 text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-8">
                <BadgeAlert size={14} />
                Inteligência Artificial gerada em {new Date().toLocaleDateString()}
            </div>

            {/* Modal de Detalhes */}
            <AssetDetailModal 
                isOpen={!!selectedAsset} 
                onClose={() => setSelectedAsset(null)} 
                asset={selectedAsset} 
            />
        </div>
    );
};
