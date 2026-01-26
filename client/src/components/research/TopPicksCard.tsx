
import React, { useMemo, useState, useEffect } from 'react';
import { Trophy, BadgeAlert, BarChart2, PieChart, Layers, Info, Shield, Target, Zap, AlertTriangle } from 'lucide-react';
import { RankingItem } from '../../services/research';
import { AssetDetailModal } from './AssetDetailModal';

interface TopPicksCardProps {
    picks: RankingItem[];
    assetClass: string;
}

// Simplificação: Apenas 3 Perfis
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
    const [selectedAsset, setSelectedAsset] = useState<RankingItem | null>(null);
    const [riskFilter, setRiskFilter] = useState<RiskFilter>('DEFENSIVE');

    const isBrasil10 = assetClass === 'BRASIL_10';

    // Se a classe for BRASIL_10, força sempre Defensiva e reseta se o usuário trocar de aba
    useEffect(() => {
        if (isBrasil10) {
            setRiskFilter('DEFENSIVE');
        }
    }, [assetClass, isBrasil10]);

    // Lógica de Filtragem por Perfil Simplificada
    const filteredPicks = useMemo(() => {
        let filtered = picks;

        // Filtro exato baseada no perfil salvo no banco
        if (riskFilter === 'DEFENSIVE') {
            filtered = picks.filter(p => p.riskProfile === 'DEFENSIVE');
        } else if (riskFilter === 'MODERATE') {
            filtered = picks.filter(p => p.riskProfile === 'MODERATE');
        } else if (riskFilter === 'BOLD') {
            filtered = picks.filter(p => p.riskProfile === 'BOLD');
        }

        // Reordena e pega o Top 10 da categoria selecionada
        return filtered
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map((item, idx) => ({
                ...item,
                position: idx + 1 // Recalcula posição visual
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
        if (pos === 1) return 'bg-[#D4AF37]/20 text-[#D4AF37] border-[#D4AF37]/50 shadow-[0_0_10px_rgba(212,175,55,0.2)]'; // Ouro
        if (pos === 2) return 'bg-slate-300/20 text-slate-300 border-slate-400/50'; // Prata
        if (pos === 3) return 'bg-amber-700/20 text-amber-600 border-amber-700/50'; // Bronze
        return 'bg-slate-900 text-slate-600 border-slate-800'; // Padrão
    };

    const formatCurrency = (val: number) => {
        if (!val && val !== 0) return '-';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
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
                        // BLOQUEIO: Se for Brasil 10, só renderiza o botão Defensiva
                        if (isBrasil10 && key !== 'DEFENSIVE') return null;

                        return (
                            <button
                                key={key}
                                onClick={() => setRiskFilter(key as RiskFilter)}
                                disabled={isBrasil10} // Desabilita clique se for Brasil 10 (já está selecionado)
                                className={`
                                    whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all border
                                    ${riskFilter === key 
                                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' 
                                        : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                                    }
                                    ${isBrasil10 ? 'cursor-default' : 'cursor-pointer'}
                                `}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Resumo da Carteira */}
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
                                Vértice Quant 2.0
                            </span>
                        </div>
                        <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight uppercase">
                            {isBrasil10 ? 'TOP 10 BRASIL' : assetClass.replace('_', ' ')}
                            <span className="ml-3 text-lg text-slate-500 font-medium normal-case">({RISK_LABELS[riskFilter]})</span>
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
                                Atualizado Semanalmente
                            </p>
                        </div>
                    </div>
                </div>

                {/* Diversificação */}
                <div className="lg:col-span-4 bg-[#080C14] border border-slate-800 rounded-3xl p-5 flex flex-col relative overflow-hidden h-auto min-h-[220px]">
                    <div className="flex items-center gap-2 mb-4 relative z-10 shrink-0">
                        <PieChart size={14} className="text-purple-500" />
                        <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Alocação Setorial</h3>
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
                        <Layers size={12} /> Composição da Carteira
                    </h3>
                </div>

                {filteredPicks.length === 0 ? (
                    <div className="p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-[#080C14] animate-fade-in">
                        <div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-800">
                            <AlertTriangle size={20} className="text-slate-500" />
                        </div>
                        <p className="text-slate-300 font-bold text-sm">Sem ativos para o perfil <span className="text-blue-400 uppercase">{RISK_LABELS[riskFilter]}</span></p>
                        
                        {isBrasil10 ? (
                            <p className="text-slate-500 text-xs mt-2 max-w-sm mx-auto">
                                A Carteira Brasil 10 é estritamente <strong>Defensiva</strong>. Se a lista está vazia, é necessário aguardar a próxima atualização do algoritmo (Segunda-feira 08h).
                            </p>
                        ) : (
                            <p className="text-slate-500 text-xs mt-2 max-w-sm mx-auto">
                                Nenhum ativo atingiu o score mínimo de qualidade para este perfil de risco nesta rodada de análise.
                            </p>
                        )}
                    </div>
                ) : (
                    filteredPicks.map((pick, idx) => {
                        const isFII = pick.type === 'FII';
                        const fairValueLabel = isFII ? "Bazin (Teto)" : "Valor Justo";

                        return (
                            <div 
                                key={idx} 
                                onClick={() => setSelectedAsset(pick)}
                                className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 hover:border-slate-600 hover:bg-[#0F131E] transition-all cursor-pointer group relative overflow-hidden"
                            >
                                <div className="flex flex-col md:flex-row gap-6 items-center">
                                    <div className="flex items-center gap-4 flex-1 w-full">
                                        <div className={`w-8 h-8 flex items-center justify-center rounded-lg font-black text-sm border ${getRankStyle(pick.position)}`}>
                                            {pick.position}
                                        </div>
                                        
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h4 className="text-base font-black text-white tracking-tight">{pick.ticker}</h4>
                                                {getRiskBadge(pick.riskProfile)}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-bold uppercase border border-slate-700">
                                                    {pick.sector || 'Geral'}
                                                </span>
                                                <p className="text-[10px] text-slate-500 font-medium truncate">
                                                    {pick.name}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full md:w-auto md:flex-[2.5]">
                                        <div className="text-center md:text-left">
                                            <p className="text-[8px] font-bold text-slate-500 uppercase">Preço</p>
                                            <p className="text-xs font-bold text-slate-300 font-mono">{formatCurrency(pick.currentPrice)}</p>
                                        </div>
                                        <div className="text-center md:text-left">
                                            <p className="text-[8px] font-bold text-slate-500 uppercase">{fairValueLabel}</p>
                                            <p className="text-xs font-bold text-white font-mono">{formatCurrency(pick.targetPrice || 0)}</p>
                                        </div>
                                        <div className="text-center md:text-left">
                                            <p className="text-[8px] font-bold text-slate-500 uppercase">Yield</p>
                                            <p className="text-xs font-bold text-emerald-400 font-mono">{pick.metrics?.dy ? `${pick.metrics.dy.toFixed(1)}%` : '-'}</p>
                                        </div>
                                        <div className="text-center md:text-left">
                                            <p className="text-[8px] font-bold text-slate-500 uppercase">Qualidade</p>
                                            <div className="h-1.5 w-16 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                                                <div className="h-full bg-blue-500" style={{ width: `${pick.metrics?.structural?.quality || 50}%` }}></div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between w-full md:w-auto gap-4 border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
                                        <div className="flex-1 md:w-24">
                                            <div className="flex justify-between text-[8px] font-black mb-1 uppercase">
                                                <span className="text-slate-500">Score</span>
                                                <span className={getScoreTextColor(pick.score)}>{pick.score}</span>
                                            </div>
                                            <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full transition-all duration-700 ${getScoreColor(pick.score)}`} style={{ width: `${pick.score}%` }}></div>
                                            </div>
                                        </div>

                                        <div className={`px-3 py-1.5 rounded-lg border flex flex-col items-center min-w-[80px] ${
                                            pick.action === 'BUY' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 
                                            'text-slate-400 bg-slate-800 border-slate-700'
                                        }`}>
                                            <span className="text-[9px] font-black tracking-tighter">{pick.action === 'BUY' ? 'COMPRAR' : 'AGUARDAR'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <div className="flex items-center justify-center gap-2 text-[9px] text-slate-600 font-bold uppercase tracking-widest mt-8 py-4 border-t border-slate-800/30">
                <BadgeAlert size={12} />
                Metodologia Vértice v2.4 • Suitability Engine Integrado
            </div>

            <AssetDetailModal 
                isOpen={!!selectedAsset} 
                onClose={() => setSelectedAsset(null)} 
                asset={selectedAsset} 
            />
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
    if (sectors.length === 0) return <p className="text-[10px] text-slate-500">Sem dados.</p>;

    return (
        <div className="flex flex-row items-start gap-4 w-full h-full">
            <div className="relative w-24 h-24 shrink-0 my-auto">
                <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                    <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1e293b" strokeWidth="8"></circle>
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
                                strokeWidth="8"
                                strokeDasharray={dash}
                                strokeDashoffset={offset}
                                className="transition-all duration-1000 ease-out"
                            ></circle>
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs font-black text-white">{picks.length}</span>
                    <span className="text-[8px] text-slate-500 uppercase font-bold">Total</span>
                </div>
            </div>

            <div className="flex-1 grid grid-cols-1 gap-y-1 content-center">
                {sectors.map((sector, i) => (
                    <div key={sector.name} className="flex items-center justify-between text-[9px] group w-full">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                            <span className="text-slate-400 truncate max-w-[100px] group-hover:text-slate-200 transition-colors" title={sector.name}>{sector.name}</span>
                        </div>
                        <span className="font-bold text-slate-300 font-mono ml-1">{Math.round(sector.percent)}%</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
