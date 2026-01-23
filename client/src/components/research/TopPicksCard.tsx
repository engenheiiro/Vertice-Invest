import React, { useMemo, useState } from 'react';
import { TrendingUp, Minus, Trophy, BadgeAlert, Target, BarChart2, MousePointerClick, PieChart, Zap, Layers } from 'lucide-react';
import { RankingItem } from '../../services/research';
import { AssetDetailModal } from './AssetDetailModal';

interface TopPicksCardProps {
    picks: RankingItem[];
    assetClass: string;
}

// Cores para o Gráfico e Tags
const COLORS = [
    '#3B82F6', // Blue
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#6366F1', // Indigo
    '#D4AF37', // Gold
];

export const TopPicksCard: React.FC<TopPicksCardProps> = ({ picks, assetClass }) => {
    const [selectedAsset, setSelectedAsset] = useState<RankingItem | null>(null);

    // 1. Ordenação e Dados
    const sortedPicks = useMemo(() => {
        return [...picks].sort((a, b) => a.position - b.position);
    }, [picks]);

    // 2. Estatísticas Gerais da Carteira
    const stats = useMemo(() => {
        if (!picks.length) return { avgScore: 0, avgDy: 0, avgUpside: 0 };
        
        const totalScore = picks.reduce((acc, curr) => acc + curr.score, 0);
        const totalDy = picks.reduce((acc, curr) => acc + (curr.metrics.dy || 0), 0);
        
        // Upside = ((Alvo - PreçoAtual) / PreçoAtual) * 100 roughly derived from targetPrice logic
        // Como não temos currentPrice direto no RankingItem (temos no Asset), vamos estimar pelo targetPrice se score for alto,
        // ou usar score como proxy de qualidade. Para simplificar visualmente:
        // Vamos usar o Score médio.
        
        return {
            avgScore: Math.round(totalScore / picks.length),
            avgDy: (totalDy / picks.length).toFixed(2),
            count: picks.length
        };
    }, [picks]);

    // 3. Lógica do Gráfico (Tipo ou Setor)
    const chartData = useMemo(() => {
        const data: Record<string, number> = {};
        
        // Se for Brasil 10 (Misto), agrupa por TIPO implícito ou definido
        // Se for Específico (STOCK), agrupa por SETOR
        const isMixed = assetClass === 'BRASIL_10';

        picks.forEach(p => {
            let key = 'Outros';
            if (isMixed) {
                // Tenta inferir tipo pelo ticker se não tiver campo type explícito no RankingItem
                if (p.ticker.endsWith('11')) key = 'FIIs / Units';
                else if (p.ticker.length <= 4 && !/\d/.test(p.ticker)) key = 'Cripto/USD';
                else key = 'Ações';
            } else {
                // Agrupa por Setor (Mock de setores se não vier do backend)
                // O backend idealmente deve enviar "sector" no RankingItem. 
                // Se não vier, usamos um fallback visual.
                key = (p as any).sector || 'Geral'; 
            }
            data[key] = (data[key] || 0) + 1;
        });

        const total = picks.length;
        let accumulatedPercent = 0;

        return Object.entries(data)
            .sort(([,a], [,b]) => b - a)
            .map(([label, count], index) => {
                const percent = (count / total) * 100;
                const item = {
                    label,
                    percent,
                    value: count,
                    color: COLORS[index % COLORS.length],
                    offset: 100 - accumulatedPercent + 25, // SVG circle logic
                    dash: `${percent} ${100 - percent}`
                };
                accumulatedPercent += percent;
                return item;
            });
    }, [picks, assetClass]);

    const formatCurrency = (val: number) => {
        if (!val) return 'N/A';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const getActionColor = (action: string) => {
        if (action === 'BUY') return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        if (action === 'SELL') return 'text-red-500 bg-red-500/10 border-red-500/20';
        return 'text-slate-400 bg-slate-800 border-slate-700';
    };

    return (
        <div className="max-w-7xl mx-auto animate-fade-in space-y-6 pb-20">
            
            {/* === HEADER DASHBOARD === */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Coluna 1: Resumo da Carteira */}
                <div className="lg:col-span-2 bg-[#080C14] border border-slate-800 rounded-3xl p-8 relative overflow-hidden flex flex-col justify-between">
                    <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                        <Trophy size={140} className="text-white" />
                    </div>
                    
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center border border-blue-600/30">
                                <BarChart2 size={20} className="text-blue-500" />
                            </div>
                            <span className="text-xs font-bold text-blue-400 uppercase tracking-widest bg-blue-900/10 px-2 py-1 rounded border border-blue-900/20">
                                Carteira Recomendada
                            </span>
                        </div>
                        <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight uppercase mb-2">
                            {assetClass.replace('_', ' ')}
                        </h2>
                        <p className="text-slate-400 text-sm max-w-lg">
                            Seleção algorítmica dos ativos com maior assimetria de valor e qualidade fundamentada pelo Neural Engine.
                        </p>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mt-8">
                        <div className="bg-[#0B101A] border border-slate-800 p-4 rounded-2xl">
                            <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Score Médio</p>
                            <p className="text-2xl font-black text-white">{stats.avgScore}<span className="text-sm text-slate-600">/100</span></p>
                        </div>
                        <div className="bg-[#0B101A] border border-slate-800 p-4 rounded-2xl">
                            <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">DY Projetado</p>
                            <p className="text-2xl font-black text-emerald-400">{stats.avgDy}%</p>
                        </div>
                        <div className="bg-[#0B101A] border border-slate-800 p-4 rounded-2xl">
                            <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Ativos</p>
                            <p className="text-2xl font-black text-white">{stats.count}</p>
                        </div>
                    </div>
                </div>

                {/* Coluna 2: Gráfico de Distribuição */}
                <div className="bg-[#080C14] border border-slate-800 rounded-3xl p-6 flex flex-col relative overflow-hidden">
                    <div className="flex items-center gap-2 mb-6 z-10">
                        <PieChart size={16} className="text-purple-500" />
                        <h3 className="font-bold text-white text-sm">Distribuição {assetClass === 'BRASIL_10' ? 'por Classe' : 'Setorial'}</h3>
                    </div>

                    <div className="flex items-center gap-6 flex-1 z-10">
                        {/* SVG Donut */}
                        <div className="relative w-32 h-32 shrink-0">
                            <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1e293b" strokeWidth="6"></circle>
                                {chartData.map((slice) => (
                                    <circle 
                                        key={slice.label}
                                        cx="21" cy="21" r="15.91549430918954" 
                                        fill="transparent" 
                                        stroke={slice.color} 
                                        strokeWidth="6"
                                        strokeDasharray={slice.dash}
                                        strokeDashoffset={slice.offset}
                                        className="transition-all duration-1000 ease-out hover:stroke-[8] cursor-pointer"
                                    />
                                ))}
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="text-[10px] font-black text-white">100%</span>
                            </div>
                        </div>

                        {/* Legenda */}
                        <div className="flex-1 space-y-2 overflow-y-auto max-h-[160px] custom-scrollbar pr-2">
                            {chartData.map((slice) => (
                                <div key={slice.label} className="flex justify-between items-center text-xs">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: slice.color }}></div>
                                        <span className="text-slate-300 font-medium truncate max-w-[80px]">{slice.label}</span>
                                    </div>
                                    <span className="font-bold text-slate-500">{slice.percent.toFixed(0)}%</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    {/* Background Glow */}
                    <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-purple-600/10 rounded-full blur-[50px]"></div>
                </div>
            </div>

            {/* === LISTA DE ATIVOS === */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Layers size={14} /> Ranking Oficial
                    </h3>
                    <span className="text-[10px] font-mono text-slate-600">Atualizado: Hoje</span>
                </div>

                {sortedPicks.map((pick, idx) => {
                    const probability = pick.probability || 50;
                    
                    return (
                        <div 
                            key={idx} 
                            onClick={() => setSelectedAsset(pick)}
                            className="bg-[#080C14] border border-slate-800 rounded-2xl p-4 hover:border-slate-600 hover:bg-[#0F131E] transition-all cursor-pointer group relative overflow-hidden"
                        >
                            {/* Faixa lateral para Top 3 */}
                            {idx < 3 && (
                                <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                                    idx === 0 ? 'bg-[#D4AF37]' : idx === 1 ? 'bg-slate-400' : 'bg-orange-700'
                                }`}></div>
                            )}

                            <div className="flex flex-col md:flex-row gap-6 items-center">
                                
                                {/* 1. Rank & Info */}
                                <div className="flex items-center gap-4 flex-1 w-full">
                                    <div className={`w-10 h-10 flex items-center justify-center rounded-xl font-black text-lg border ml-2 ${
                                        idx === 0 ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30' : 
                                        idx === 1 ? 'bg-slate-700/30 text-slate-300 border-slate-600' : 
                                        idx === 2 ? 'bg-orange-900/20 text-orange-600 border-orange-800' : 
                                        'bg-slate-900 text-slate-600 border-slate-800'
                                    }`}>
                                        {pick.position}
                                    </div>
                                    
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-lg font-black text-white tracking-tight">{pick.ticker}</h4>
                                            {pick.thesis && (
                                                <span className="hidden sm:inline-block text-[9px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-bold uppercase border border-slate-700">
                                                    {pick.thesis}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 font-medium truncate max-w-[200px] md:max-w-xs">
                                            {pick.name}
                                        </p>
                                    </div>
                                </div>

                                {/* 2. Métricas Chave (Grid Interno) */}
                                <div className="grid grid-cols-3 gap-6 w-full md:w-auto md:flex-1">
                                    <div className="text-center md:text-left">
                                        <p className="text-[9px] font-bold text-slate-500 uppercase">Preço Teto</p>
                                        <p className="text-sm font-bold text-white font-mono">{formatCurrency(pick.metrics?.grahamPrice || pick.targetPrice)}</p>
                                    </div>
                                    <div className="text-center md:text-left">
                                        <p className="text-[9px] font-bold text-slate-500 uppercase">Div. Yield</p>
                                        <p className="text-sm font-bold text-emerald-400 font-mono">{pick.metrics?.dy?.toFixed(1)}%</p>
                                    </div>
                                    <div className="text-center md:text-left">
                                        <p className="text-[9px] font-bold text-slate-500 uppercase">Potencial</p>
                                        <p className="text-sm font-bold text-blue-400 font-mono">
                                            {pick.metrics?.earningsYield ? `${pick.metrics.earningsYield}%` : '-'}
                                        </p>
                                    </div>
                                </div>

                                {/* 3. Score & Ação */}
                                <div className="flex items-center justify-between w-full md:w-auto gap-6 border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
                                    
                                    {/* Score Bar */}
                                    <div className="flex-1 md:w-32">
                                        <div className="flex justify-between text-[9px] font-bold mb-1 uppercase">
                                            <span className="text-slate-500">IA Score</span>
                                            <span className={pick.score > 70 ? 'text-emerald-400' : 'text-yellow-400'}>{pick.score}/100</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                                            <div 
                                                className={`h-full rounded-full ${pick.score > 75 ? 'bg-emerald-500' : pick.score > 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                style={{ width: `${pick.score}%` }}
                                            ></div>
                                        </div>
                                    </div>

                                    {/* Botão Ação */}
                                    <div className={`px-4 py-2 rounded-lg border flex flex-col items-center min-w-[80px] ${getActionColor(pick.action)}`}>
                                        <div className="flex items-center gap-1">
                                            {pick.action === 'BUY' && <TrendingUp size={14} />}
                                            {pick.action === 'WAIT' && <Minus size={14} />}
                                            {pick.action === 'SELL' && <TrendingUp size={14} className="rotate-180" />}
                                            <span className="text-xs font-black">{pick.action}</span>
                                        </div>
                                    </div>

                                </div>
                            </div>
                            
                            {/* Hover Action */}
                            <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="bg-blue-600/20 text-blue-400 p-1.5 rounded-lg">
                                    <MousePointerClick size={16} />
                                </div>
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