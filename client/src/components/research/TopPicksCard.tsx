
import React, { useMemo, useState, useEffect } from 'react';
import { Trophy, BarChart2, Layers, Shield, Target, Zap, Minus, Wallet, PieChart, PlusCircle } from 'lucide-react';
import { RankingItem } from '../../services/research';
import { AssetDetailModal } from './AssetDetailModal';
import { useWallet } from '../../contexts/WalletContext';
// @ts-ignore
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
    const { assets, kpis, isPrivacyMode } = useWallet();
    const navigate = useNavigate();
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
                visualPosition: idx + 1
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

    const getScoreTextColor = (score: number) => {
        if (score >= 90) return 'text-emerald-400';
        if (score >= 75) return 'text-green-400';
        if (score >= 60) return 'text-blue-400';
        if (score >= 50) return 'text-yellow-400';
        return 'text-red-500';
    };

    // Lógica de Cores do Yield (Pedido 2)
    const getYieldColor = (dy: number) => {
        if (!dy || dy <= 0) return 'text-slate-500';
        if (dy > 6) return 'text-emerald-400';
        return 'text-yellow-400';
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
        if (isPrivacyMode) return '••••';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: "compact" }).format(val);
    };

    return (
        <div className="max-w-7xl mx-auto animate-fade-in space-y-6 pb-20">
            {/* Header com Filtros de Perfil */}
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
                
                {/* 1. RESUMO */}
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

                {/* 2. MINHA CARTEIRA */}
                <div className="lg:col-span-4 bg-[#080C14] border border-slate-800 rounded-3xl p-5 flex flex-col relative overflow-hidden min-h-[240px]">
                    <div className="flex items-center gap-2 mb-4 relative z-10 shrink-0 border-b border-slate-800/50 pb-2">
                        <Wallet size={14} className="text-emerald-500" />
                        <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Minha Alocação</h3>
                    </div>
                    <div className="flex-1 flex flex-col justify-center relative z-10">
                        <UserWalletSectorChart assetClass={assetClass} />
                    </div>
                </div>

                {/* 3. ALOCAÇÃO IDEAL */}
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

            {/* LISTA DETALHADA */}
            <div className="space-y-3">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Layers size={12} /> Composição Detalhada
                    </h3>
                </div>
                {filteredPicks.map((pick, idx) => {
                        const isFII = pick.type === 'FII';
                        const fairValueLabel = "Preço Teto";

                        // Encontra se o usuário possui este ativo
                        const userAsset = assets.find(a => a.ticker === pick.ticker);
                        const userHasAsset = !!userAsset && userAsset.quantity > 0;
                        const userAllocPercent = userHasAsset && kpis.totalEquity > 0 
                            ? (userAsset.totalValue / kpis.totalEquity) * 100 
                            : 0;
                        
                        const idealPercent = filteredPicks.length > 0 ? (100 / filteredPicks.length) : 0;
                        
                        // Cálculo do Rebalanceamento ($)
                        const idealValue = kpis.totalEquity * (idealPercent / 100);
                        const currentValue = userHasAsset ? userAsset.totalValue : 0;
                        const rebalanceDelta = currentValue - idealValue; 

                        return (
                            <div key={idx} onClick={() => setSelectedAsset(pick)} className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 hover:border-slate-600 hover:bg-[#0F131E] transition-all cursor-pointer group relative overflow-hidden">
                                
                                <div className="flex flex-col xl:flex-row gap-6 items-center">
                                    {/* SEÇÃO 1: IDENTIDADE E SCORES (Agora na mesma linha em telas largas) */}
                                    <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 items-center">
                                        
                                        {/* Ticker & Info (3 Colunas) */}
                                        <div className="lg:col-span-3 flex items-center gap-4">
                                            <div className={`w-8 h-8 flex flex-col items-center justify-center rounded-lg border shrink-0 ${getRankStyle(pick.position || pick.visualPosition)}`}>
                                                <span className="font-black text-sm leading-none">{pick.position || pick.visualPosition}</span>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center mb-1 gap-2">
                                                    <h4 className="text-base font-black text-white tracking-tight">{pick.ticker}</h4>
                                                    {getRiskBadge(pick.riskProfile)}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-bold uppercase border border-slate-700">{pick.sector || 'Geral'}</span>
                                                    <p className="text-[10px] text-slate-500 font-medium truncate hidden sm:block">{pick.name}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Dados Financeiros REORDENADOS: Preço -> Teto -> Yield */}
                                        <div className="lg:col-span-9 flex flex-col sm:flex-row items-center gap-6 w-full">
                                            
                                            <div className="flex gap-6 shrink-0">
                                                {/* 1. Preço Atual */}
                                                <div className="text-center sm:text-left">
                                                    <p className="text-[8px] font-bold text-slate-500 uppercase">Preço Atual</p>
                                                    <p className="text-xs font-bold text-slate-300 font-mono">{formatCurrency(pick.currentPrice)}</p>
                                                </div>
                                                
                                                {/* 2. Preço Teto */}
                                                <div className="text-center sm:text-left">
                                                    <p className="text-[8px] font-bold text-slate-500 uppercase">{fairValueLabel}</p>
                                                    <p className="text-xs font-bold text-blue-400 font-mono">{formatCurrency(pick.targetPrice || 0)}</p>
                                                </div>

                                                {/* 3. Yield (Com Cores) */}
                                                <div className="text-center sm:text-left">
                                                    <p className="text-[8px] font-bold text-slate-500 uppercase">Yield</p>
                                                    <p className={`text-xs font-bold font-mono ${getYieldColor(pick.metrics.dy)}`}>
                                                        {pick.metrics.dy ? pick.metrics.dy.toFixed(1) : 0}%
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Divisor Vertical (Desktop) */}
                                            <div className="hidden sm:block w-px h-8 bg-slate-800"></div>

                                            {/* Barras de Score Inline */}
                                            <div className="flex-1 grid grid-cols-3 gap-3 w-full">
                                                <div>
                                                    <p className="text-[7px] font-bold text-slate-500 uppercase mb-1 flex justify-between">
                                                        <span>Qualidade</span> <span>{pick.metrics?.structural?.quality || 50}</span>
                                                    </p>
                                                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${pick.metrics?.structural?.quality || 50}%` }}></div></div>
                                                </div>
                                                <div>
                                                    <p className="text-[7px] font-bold text-slate-500 uppercase mb-1 flex justify-between">
                                                        <span>Valuation</span> <span>{pick.metrics?.structural?.valuation || 50}</span>
                                                    </p>
                                                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pick.metrics?.structural?.valuation || 50}%` }}></div></div>
                                                </div>
                                                <div>
                                                    <p className="text-[7px] font-bold text-slate-500 uppercase mb-1 flex justify-between">
                                                        <span>Segurança</span> <span>{pick.metrics?.structural?.risk || 50}</span>
                                                    </p>
                                                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-purple-500" style={{ width: `${pick.metrics?.structural?.risk || 50}%` }}></div></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* SEÇÃO 2: ALOCAÇÃO E AÇÃO (Separado em telas largas) */}
                                    <div className="flex flex-col sm:flex-row gap-6 w-full xl:w-auto xl:border-l xl:border-slate-800 xl:pl-6">
                                        
                                        {/* Sua Posição */}
                                        <div className="flex-1 sm:w-40 flex flex-col justify-center">
                                            <div className="flex justify-between items-center mb-1">
                                                <p className="text-[8px] font-bold text-slate-500 uppercase flex items-center gap-1">
                                                    <Wallet size={8} /> Sua Posição
                                                </p>
                                                <span className="text-[8px] font-bold text-slate-600">Meta: {idealPercent.toFixed(0)}%</span>
                                            </div>
                                            
                                            {userHasAsset ? (
                                                <div>
                                                    <div className="flex justify-between items-end mb-1">
                                                        <span className="text-xs font-bold text-white font-mono">{formatCurrency(userAsset.totalValue)}</span>
                                                        <span className={`text-[9px] font-bold ${userAllocPercent > idealPercent ? 'text-yellow-500' : 'text-blue-400'}`}>
                                                            {userAllocPercent.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                    <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden relative">
                                                        <div className="h-full bg-blue-500 absolute left-0" style={{ width: `${Math.min(userAllocPercent * 5, 100)}%` }}></div>
                                                        <div className="h-full w-0.5 bg-slate-400 absolute z-10" style={{ left: `${Math.min(idealPercent * 5, 100)}%` }}></div>
                                                    </div>
                                                    
                                                    <div className="mt-2 text-right">
                                                        {rebalanceDelta > 0 ? (
                                                            <span className="text-[10px] font-black text-yellow-500 bg-yellow-900/10 px-1.5 py-0.5 rounded border border-yellow-900/20">
                                                                Excede {formatCurrency(Math.abs(rebalanceDelta))}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] font-black text-emerald-400 bg-emerald-900/10 px-1.5 py-0.5 rounded border border-emerald-900/20">
                                                                Falta {formatCurrency(Math.abs(rebalanceDelta))}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    <div className="w-full h-5 rounded bg-slate-800/50 border border-dashed border-slate-700 flex items-center justify-center">
                                                        <span className="text-[8px] text-slate-600 font-bold uppercase">Não possui</span>
                                                    </div>
                                                    <div className="text-right mt-1">
                                                        <span className="text-[10px] font-black text-emerald-400 bg-emerald-900/10 px-1.5 py-0.5 rounded border border-emerald-900/20">
                                                            Aportar ~{formatCurrency(idealValue)}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Ação */}
                                        <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 border-slate-800 pt-3 sm:pt-0 min-w-[140px]">
                                            <div className="text-center">
                                                <div className="text-[8px] font-black uppercase text-slate-500 mb-1">Score</div>
                                                <span className={`text-lg font-black ${getScoreTextColor(pick.score)}`}>{pick.score}</span>
                                            </div>
                                            <div className={`px-3 py-1.5 rounded-lg border flex flex-col items-center min-w-[80px] ${pick.action === 'BUY' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-400 bg-slate-800 border-slate-700'}`}><span className="text-[9px] font-black tracking-tighter">{pick.action === 'BUY' ? 'COMPRAR' : 'AGUARDAR'}</span></div>
                                        </div>
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

// ... (Subcomponentes UserWalletSectorChart e SectorDistribution mantidos sem alterações)
const UserWalletSectorChart = ({ assetClass }: { assetClass: string }) => {
    const { assets } = useWallet();
    const navigate = useNavigate();

    const stats = useMemo(() => {
        const allowedTypes = assetClass === 'BRASIL_10' 
            ? ['STOCK', 'FII'] 
            : assetClass === 'STOCK_US' ? ['STOCK_US'] : [assetClass];

        const filteredAssets = assets.filter(a => allowedTypes.includes(a.type));
        
        if (filteredAssets.length === 0) return { sectors: [], hasData: false, totalValue: 0 };

        const counts: Record<string, number> = {};
        let totalValue = 0;

        filteredAssets.forEach(a => {
            const sector = a.sector || 'Outros';
            const val = a.totalValue || 0; 
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

        return { sectors, hasData: true, totalValue };
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

    return (
        <div className="flex flex-row items-center gap-4 w-full h-full px-2">
            <div className="relative w-24 h-24 shrink-0">
                <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1e293b" strokeWidth="6"></circle>
                    {stats.sectors.map((sector, i) => {
                        let cumulativePercent = 0;
                        for (let j = 0; j < i; j++) cumulativePercent += stats.sectors[j].percent;
                        const dash = `${sector.percent} ${100 - sector.percent}`;
                        const offset = 100 - cumulativePercent + 25;
                        return (
                            <circle key={sector.name} cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke={COLORS[i % COLORS.length]} strokeWidth="6" strokeDasharray={dash} strokeDashoffset={offset} className="transition-all duration-1000 ease-out hover:stroke-[8] cursor-pointer"><title>{sector.name}: {Math.round(sector.percent)}%</title></circle>
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[9px] text-slate-500 uppercase font-bold">Você</span>
                </div>
            </div>
            <div className="flex-1 flex flex-col h-full">
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

    if (sectors.length === 0) return <p className="text-[10px] text-slate-500 text-center mt-10">Sem dados.</p>;

    return (
        <div className="flex flex-row items-center gap-4 w-full h-full">
            <div className="relative w-20 h-20 shrink-0 ml-2">
                <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1e293b" strokeWidth="8"></circle>
                    {sectors.map((sector, i) => {
                        let cumulativePercent = 0;
                        for (let j = 0; j < i; j++) cumulativePercent += sectors[j].percent;
                        const dash = `${sector.percent} ${100 - sector.percent}`;
                        const offset = 100 - cumulativePercent + 25;
                        return (
                            <circle key={sector.name} cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke={COLORS[i % COLORS.length]} strokeWidth="8" strokeDasharray={dash} strokeDashoffset={offset} className="transition-all duration-1000 ease-out"></circle>
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs font-black text-white">{picks.length}</span>
                </div>
            </div>

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
