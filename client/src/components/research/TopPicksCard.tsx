
// ... (imports mantidos)
import React, { useMemo, useState, useEffect } from 'react';
import { Trophy, BadgeAlert, BarChart2, PieChart, Layers, Shield, Target, Zap, AlertTriangle, Briefcase, PlusCircle, Wallet } from 'lucide-react';
import { RankingItem } from '../../services/research';
import { AssetDetailModal } from './AssetDetailModal';
import { useWallet } from '../../contexts/WalletContext';
import { useNavigate } from 'react-router-dom';

interface TopPicksCardProps {
    picks: RankingItem[];
    assetClass: string;
}

type RiskFilter = 'DEFENSIVE' | 'MODERATE' | 'BOLD';

const RISK_LABELS: Record<RiskFilter, string> = {
    'DEFENSIVE': 'Defensiva',
    'MODERATE': 'Moderado',
    'BOLD': 'Arrojado'
};

const COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1', '#D4AF37',
    '#EF4444', '#84CC16', '#14B8A6', '#F97316', '#A855F7', '#0EA5E9'
];

export const TopPicksCard: React.FC<TopPicksCardProps> = ({ picks, assetClass }) => {
    // ... (Lógica de estado e hooks mantida) ...
    const [selectedAsset, setSelectedAsset] = useState<RankingItem | null>(null);
    const [riskFilter, setRiskFilter] = useState<RiskFilter>('DEFENSIVE');

    const isBrasil10 = assetClass === 'BRASIL_10';

    useEffect(() => {
        if (isBrasil10) {
            setRiskFilter('DEFENSIVE');
        }
    }, [assetClass, isBrasil10]);

    const filteredPicks = useMemo(() => {
        let filtered = picks;

        if (riskFilter === 'DEFENSIVE') {
            filtered = picks.filter(p => p.riskProfile === 'DEFENSIVE');
        } else if (riskFilter === 'MODERATE') {
            filtered = picks.filter(p => p.riskProfile === 'MODERATE');
        } else if (riskFilter === 'BOLD') {
            filtered = picks.filter(p => p.riskProfile === 'BOLD');
        }

        return filtered
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map((item, idx) => ({
                ...item,
                position: idx + 1
            }));
    }, [picks, riskFilter]);

    const stats = useMemo(() => {
        if (!filteredPicks.length) return { avgScore: 0, avgDy: 0, count: 0 };
        const totalScore = filteredPicks.reduce((acc, curr) => acc + curr.score, 0);
        const totalDy = filteredPicks.reduce((acc, curr) => acc + (curr.metrics.dy || 0), 0);
        return {
            avgScore: Math.round(totalScore / filteredPicks.length),
            avgDy: (totalDy / filteredPicks.length).toFixed(2),
            count: filteredPicks.length
        };
    }, [filteredPicks]);

    const getScoreColor = (score: number) => {
        if (score >= 90) return 'bg-emerald-500';
        if (score >= 75) return 'bg-green-500';
        if (score >= 60) return 'bg-blue-500';
        if (score >= 50) return 'bg-yellow-500';
        return 'bg-red-600';
    };

    const getScoreTextColor = (score: number) => {
        if (score >= 90) return 'text-emerald-400';
        if (score >= 75) return 'text-green-400';
        if (score >= 60) return 'text-blue-400';
        if (score >= 50) return 'text-yellow-400';
        return 'text-red-500';
    };

    const getRiskBadge = (profile?: string) => {
        if (profile === 'DEFENSIVE') return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-900/50 flex items-center gap-1"><Shield size={8} /> Defensivo</span>;
        if (profile === 'MODERATE') return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-900/50 flex items-center gap-1"><Target size={8} /> Moderado</span>;
        if (profile === 'BOLD') return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-900/50 flex items-center gap-1"><Zap size={8} /> Arrojado</span>;
        return null;
    };

    const getRankStyle = (pos: number) => {
        if (pos === 1) return 'bg-[#D4AF37]/20 text-[#D4AF37] border-[#D4AF37]/50 shadow-[0_0_10px_rgba(212,175,55,0.2)]';
        if (pos === 2) return 'bg-slate-300/20 text-slate-300 border-slate-400/50';
        if (pos === 3) return 'bg-amber-700/20 text-amber-600 border-amber-700/50';
        return 'bg-slate-900 text-slate-600 border-slate-800';
    };

    const formatCurrency = (val: number) => {
        if (!val && val !== 0) return '-';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    return (
        <div className="max-w-7xl mx-auto animate-fade-in space-y-6 pb-20">
            {/* Header com Filtros de Perfil (Mantido) */}
            <div className="bg-[#080C14] border border-slate-800 rounded-3xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-lg">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800">
                        <Target size={20} className="text-slate-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white">Perfil da Carteira</h3>
                        <p className="text-[10px] text-slate-500">Selecione o nível de risco para gerar o Top 10 específico.</p>
                    </div>
                </div>
                <div className="flex overflow-x-auto gap-2 no-scrollbar w-full md:w-auto pb-2 md:pb-0">
                    {Object.entries(RISK_LABELS).map(([key, label]) => {
                        if (isBrasil10 && key !== 'DEFENSIVE') return null;
                        return (
                            <button
                                key={key}
                                onClick={() => setRiskFilter(key as RiskFilter)}
                                disabled={isBrasil10}
                                className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all border ${riskFilter === key ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300 hover:bg-slate-800'} ${isBrasil10 ? 'cursor-default' : 'cursor-pointer'}`}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* --- GRID TRIPLO (4-4-4) --- */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* 1. RESUMO DA CARTEIRA (Mantido) */}
                <div className="lg:col-span-4 bg-[#080C14] border border-slate-800 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between shadow-2xl min-h-[240px]">
                    <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
                        <Trophy size={120} className="text-white" />
                    </div>
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 bg-blue-600/20 rounded-lg flex items-center justify-center border border-blue-600/30">
                                <BarChart2 size={16} className="text-blue-500" />
                            </div>
                            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-blue-900/10 px-2 py-0.5 rounded border border-blue-900/20">
                                Vértice Quant 2.0
                            </span>
                        </div>
                        <h2 className="text-xl font-black text-white tracking-tight uppercase leading-none truncate" title={isBrasil10 ? 'TOP 10 BRASIL' : assetClass.replace('_', ' ')}>
                            {isBrasil10 ? 'TOP 10 BRASIL' : assetClass.replace('_', ' ')}
                        </h2>
                        <span className="text-sm text-slate-500 font-medium normal-case block mt-1">{RISK_LABELS[riskFilter]} Selection</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-4">
                        <div className="bg-[#0B101A] border border-slate-800 p-2.5 rounded-xl text-center">
                            <p className="text-[8px] text-slate-500 font-bold uppercase mb-0.5">Score</p>
                            <p className={`text-sm font-black ${getScoreTextColor(stats.avgScore)}`}>{stats.avgScore}</p>
                        </div>
                        <div className="bg-[#0B101A] border border-slate-800 p-2.5 rounded-xl text-center">
                            <p className="text-[8px] text-slate-500 font-bold uppercase mb-0.5">Yield 12m</p>
                            <p className="text-sm font-black text-emerald-400">{stats.avgDy}%</p>
                        </div>
                        <div className="bg-[#0B101A] border border-slate-800 p-2.5 rounded-xl text-center">
                            <p className="text-[8px] text-slate-500 font-bold uppercase mb-0.5">Ativos</p>
                            <p className="text-sm font-black text-white">{stats.count}</p>
                        </div>
                    </div>
                </div>

                {/* 2. MINHA CARTEIRA (Mantido) */}
                <div className="lg:col-span-4 bg-[#080C14] border border-slate-800 rounded-3xl p-5 flex flex-col relative overflow-hidden min-h-[240px]">
                    <div className="flex items-center gap-2 mb-4 relative z-10 shrink-0 border-b border-slate-800/50 pb-2">
                        <Wallet size={14} className="text-emerald-500" />
                        <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Minha Alocação</h3>
                    </div>
                    <div className="flex-1 flex flex-col justify-center relative z-10">
                        <UserWalletSectorChart assetClass={assetClass} />
                    </div>
                </div>

                {/* 3. ALOCAÇÃO SETORIAL RECOMENDADA (Ajustado) */}
                <div className="lg:col-span-4 bg-[#080C14] border border-slate-800 rounded-3xl p-5 flex flex-col relative overflow-hidden min-h-[240px]">
                    <div className="flex items-center gap-2 mb-4 relative z-10 shrink-0 border-b border-slate-800/50 pb-2">
                        <PieChart size={14} className="text-purple-500" />
                        <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Exposição Ideal</h3>
                    </div>
                    <div className="flex-1 flex flex-col justify-center relative z-10">
                        <SectorDistribution picks={filteredPicks} />
                    </div>
                    <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-purple-900/10 rounded-full blur-[50px]"></div>
                </div>
            </div>

            {/* LISTA DETALHADA (Mantida) */}
            <div className="space-y-3">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Layers size={12} /> Composição Detalhada
                    </h3>
                </div>
                {/* ... (Renderização dos itens mantida) ... */}
                {filteredPicks.map((pick, idx) => {
                        const isFII = pick.type === 'FII';
                        const fairValueLabel = isFII ? "Bazin (Teto)" : "Valor Justo";
                        return (
                            <div key={idx} onClick={() => setSelectedAsset(pick)} className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 hover:border-slate-600 hover:bg-[#0F131E] transition-all cursor-pointer group relative overflow-hidden">
                                <div className="flex flex-col md:flex-row gap-6 items-center">
                                    <div className="flex items-center gap-4 flex-1 w-full">
                                        <div className={`w-8 h-8 flex items-center justify-center rounded-lg font-black text-sm border ${getRankStyle(pick.position)}`}>{pick.position}</div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h4 className="text-base font-black text-white tracking-tight">{pick.ticker}</h4>
                                                {getRiskBadge(pick.riskProfile)}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-bold uppercase border border-slate-700">{pick.sector || 'Geral'}</span>
                                                <p className="text-[10px] text-slate-500 font-medium truncate">{pick.name}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full md:w-auto md:flex-[2.5]">
                                        <div className="text-center md:text-left"><p className="text-[8px] font-bold text-slate-500 uppercase">Preço</p><p className="text-xs font-bold text-slate-300 font-mono">{formatCurrency(pick.currentPrice)}</p></div>
                                        <div className="text-center md:text-left"><p className="text-[8px] font-bold text-slate-500 uppercase">{fairValueLabel}</p><p className="text-xs font-bold text-white font-mono">{formatCurrency(pick.targetPrice || 0)}</p></div>
                                        <div className="text-center md:text-left"><p className="text-[8px] font-bold text-slate-500 uppercase">Yield</p><p className="text-xs font-bold text-emerald-400 font-mono">{pick.metrics?.dy ? `${pick.metrics.dy.toFixed(1)}%` : '-'}</p></div>
                                        <div className="text-center md:text-left"><p className="text-[8px] font-bold text-slate-500 uppercase">Qualidade</p><div className="h-1.5 w-16 bg-slate-800 rounded-full mt-1.5 overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${pick.metrics?.structural?.quality || 50}%` }}></div></div></div>
                                    </div>
                                    <div className="flex items-center justify-between w-full md:w-auto gap-4 border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
                                        <div className="flex-1 md:w-24"><div className="flex justify-between text-[8px] font-black mb-1 uppercase"><span className="text-slate-500">Score</span><span className={getScoreTextColor(pick.score)}>{pick.score}</span></div><div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${getScoreColor(pick.score)}`} style={{ width: `${pick.score}%` }}></div></div></div>
                                        <div className={`px-3 py-1.5 rounded-lg border flex flex-col items-center min-w-[80px] ${pick.action === 'BUY' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-400 bg-slate-800 border-slate-700'}`}><span className="text-[9px] font-black tracking-tighter">{pick.action === 'BUY' ? 'COMPRAR' : 'AGUARDAR'}</span></div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                }
            </div>

            <AssetDetailModal isOpen={!!selectedAsset} onClose={() => setSelectedAsset(null)} asset={selectedAsset} />
        </div>
    );
};

// ... (UserWalletSectorChart mantido) ...
const UserWalletSectorChart = ({ assetClass }: { assetClass: string }) => {
    const { assets } = useWallet();
    const navigate = useNavigate();

    const stats = useMemo(() => {
        const allowedTypes = assetClass === 'BRASIL_10' 
            ? ['STOCK', 'FII'] 
            : assetClass === 'STOCK_US' ? ['STOCK_US'] : [assetClass];

        const filteredAssets = assets.filter(a => allowedTypes.includes(a.type));
        
        if (filteredAssets.length === 0) return { sectors: [], hasData: false };

        const counts: Record<string, number> = {};
        let totalValue = 0;

        filteredAssets.forEach(a => {
            const sector = a.sector || 'Outros';
            const val = a.totalValue || (a.quantity * a.currentPrice);
            counts[sector] = (counts[sector] || 0) + val;
            totalValue += val;
        });

        const sectors = Object.entries(counts)
            .map(([name, value]) => ({ 
                name, 
                value, 
                percent: totalValue > 0 ? (value / totalValue) * 100 : 0 
            }))
            .sort((a, b) => b.value - a.value);

        return { sectors, hasData: true };
    }, [assets, assetClass]);

    if (!stats.hasData) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <div className="w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center mb-2 border border-slate-800">
                    <Wallet size={16} className="text-slate-500" />
                </div>
                <p className="text-[10px] text-slate-500 font-bold mb-3">Sem ativos nesta categoria.</p>
                <button onClick={() => navigate('/wallet')} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-lg transition-colors">
                    <PlusCircle size={12} /> Adicionar
                </button>
            </div>
        );
    }

    let cumulativePercent = 0;

    return (
        <div className="flex flex-row items-center gap-4 w-full h-full px-2">
            <div className="relative w-24 h-24 shrink-0">
                <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1e293b" strokeWidth="6"></circle>
                    {stats.sectors.map((sector, i) => {
                        const dash = `${sector.percent} ${100 - sector.percent}`;
                        const offset = 100 - cumulativePercent + 25;
                        cumulativePercent += sector.percent;
                        return (
                            <circle key={sector.name} cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke={COLORS[i % COLORS.length]} strokeWidth="6" strokeDasharray={dash} strokeDashoffset={offset} className="transition-all duration-1000 ease-out hover:stroke-[8] cursor-pointer"><title>{sector.name}: {Math.round(sector.percent)}%</title></circle>
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[9px] text-slate-500 uppercase font-bold">Você</span>
                </div>
            </div>
            <div className="flex-1 grid grid-cols-1 gap-y-1 content-center overflow-y-auto max-h-[140px] custom-scrollbar pr-1">
                {stats.sectors.map((sector, i) => (
                    <div key={sector.name} className="flex items-center justify-between text-[9px] group w-full">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                            <span className="text-slate-400 truncate max-w-[80px] group-hover:text-slate-200 transition-colors" title={sector.name}>{sector.name}</span>
                        </div>
                        <span className="font-bold text-slate-300 font-mono ml-1">{Math.round(sector.percent)}%</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

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
    if (sectors.length === 0) return <p className="text-[10px] text-slate-500 text-center mt-10">Sem dados.</p>;

    return (
        <div className="flex flex-row items-center gap-4 w-full h-full">
            <div className="relative w-20 h-20 shrink-0 ml-2">
                <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1e293b" strokeWidth="8"></circle>
                    {sectors.map((sector, i) => {
                        const dash = `${sector.percent} ${100 - sector.percent}`;
                        const offset = 100 - cumulativePercent + 25;
                        cumulativePercent += sector.percent;
                        return (
                            <circle key={sector.name} cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke={COLORS[i % COLORS.length]} strokeWidth="8" strokeDasharray={dash} strokeDashoffset={offset} className="transition-all duration-1000 ease-out"></circle>
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs font-black text-white">{picks.length}</span>
                </div>
            </div>

            {/* Aumentado max-h para evitar corte */}
            <div className="flex-1 grid grid-cols-1 gap-y-1 content-center overflow-y-auto max-h-[160px] custom-scrollbar pr-1">
                {sectors.map((sector, i) => (
                    <div key={sector.name} className="flex items-center justify-between text-[9px] group w-full">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                            <span className="text-slate-400 truncate max-w-[90px] group-hover:text-slate-200 transition-colors" title={sector.name}>{sector.name}</span>
                        </div>
                        <span className="font-bold text-slate-300 font-mono ml-1">{Math.round(sector.percent)}%</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
