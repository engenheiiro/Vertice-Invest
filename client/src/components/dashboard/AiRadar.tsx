
import React, { useState, useMemo } from 'react';
import { Radar, Zap, Lock, TrendingUp, AlertTriangle, Shield, Activity, Crown, Search, Info, History, Filter, Sparkles, BookOpen, Medal, Check } from 'lucide-react';
import { AiSignal } from '../../hooks/useDashboardData';
// @ts-ignore
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface AiRadarProps {
    signals: AiSignal[];
    isLoading?: boolean;
    lastUpdated?: Date | null;
}

type FilterType = 'ALL' | 'STOCK' | 'FII' | 'CRYPTO';

export const AiRadar: React.FC<AiRadarProps> = ({ signals, isLoading = false, lastUpdated }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [filter, setFilter] = useState<FilterType>('ALL');
    const [goldOnly, setGoldOnly] = useState(false); 
    
    const hasAccess = user?.plan === 'PRO' || user?.plan === 'BLACK';

    // Lógica de Filtro
    const filteredSignals = useMemo(() => {
        if (!hasAccess) return signals.slice(0, 3);
        
        return signals.filter(s => {
            const matchesType = filter === 'ALL' || s.assetType === filter;
            const matchesQuality = goldOnly ? s.quality === 'GOLD' : true;
            return matchesType && matchesQuality;
        });
    }, [signals, filter, goldOnly, hasAccess]);

    const hasDelayedSignals = signals.some(s => s.type === 'DELAYED');
    const isEmpty = filteredSignals.length === 0 && !hasDelayedSignals;

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'bg-emerald-500';
        if (score >= 60) return 'bg-yellow-500';
        return 'bg-red-500';
    };

    const getRiskProfileBadge = (profile?: string) => {
        if (profile === 'DEFENSIVE') return <span className="text-[8px] font-bold text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded border border-emerald-900/50 flex items-center gap-1 uppercase"><Shield size={8} /> Defensivo</span>;
        if (profile === 'MODERATE') return <span className="text-[8px] font-bold text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded border border-blue-900/50 flex items-center gap-1 uppercase"><Activity size={8} /> Moderado</span>;
        if (profile === 'BOLD') return <span className="text-[8px] font-bold text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded border border-purple-900/50 flex items-center gap-1 uppercase"><Zap size={8} /> Arrojado</span>;
        return <span className="text-[8px] font-bold text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700 flex items-center gap-1 uppercase"><Search size={8} /> Scanner</span>;
    };

    const handleSignalClick = (ticker: string) => {
        if (!hasAccess) return;
        navigate('/research', { state: { openTicker: ticker } });
    };

    const handleHistoryClick = () => {
        navigate('/radar');
    };

    if (isLoading) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[450px]">
                <div className="p-4 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                    <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-2">
                        <Radar size={14} className="text-purple-500 animate-spin-slow" /> Radar Alpha
                    </h3>
                </div>
                <div className="flex-1 p-3 space-y-3 bg-gradient-to-b from-[#080C14] to-[#05070a]">
                    {[...Array(3)].map((_, i) => <div key={i} className="p-4 rounded-xl border border-slate-800 bg-[#0F131E] animate-pulse h-24"></div>)}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl flex flex-col h-[450px] relative group">
            
            {/* Header com Rounded Top */}
            <div className="p-4 border-b border-slate-800 bg-[#0B101A] flex flex-col gap-3 rounded-t-2xl">
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-2">
                                <Radar size={14} className="text-purple-500 animate-spin-slow" />
                                Radar Alpha
                            </h3>
                            
                            <div className="group/tooltip relative flex items-center z-50">
                                <Info size={12} className="text-slate-600 cursor-help hover:text-blue-400 transition-colors" />
                                <div className="absolute left-0 top-6 w-60 p-4 bg-[#0F1729] border border-slate-700 rounded-xl shadow-2xl z-50 opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none text-left">
                                    <p className="text-[10px] text-slate-300 leading-relaxed mb-2">
                                        O Radar Alpha identifica anomalias de preço em tempo real.
                                    </p>
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-2 text-[10px]">
                                            <Medal size={12} className="text-[#D4AF37]" />
                                            <span className="text-[#D4AF37] font-bold">Oportunidade Ouro:</span>
                                            <span className="text-slate-400">Sinal extremo (Ex: RSI &lt; 30).</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px]">
                                            <Medal size={12} className="text-slate-400" />
                                            <span className="text-slate-300 font-bold">Oportunidade Prata:</span>
                                            <span className="text-slate-400">Ativo "Quase Lá".</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Data de Atualização */}
                        {lastUpdated && (
                            <span className="text-[8px] text-slate-500 mt-0.5 ml-6 font-mono">
                                Atualizado: {lastUpdated.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}
                            </span>
                        )}
                    </div>

                    {!hasAccess && (
                        <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 flex items-center gap-1">
                            <Lock size={10} /> Pro
                        </span>
                    )}
                </div>

                {hasAccess && (
                    <div className="flex items-center justify-between">
                        <div className="flex bg-slate-900 rounded p-0.5 border border-slate-800">
                            <button onClick={() => setFilter('ALL')} className={`px-1.5 py-0.5 text-[8px] font-bold rounded ${filter === 'ALL' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>TUDO</button>
                            <button onClick={() => setFilter('STOCK')} className={`px-1.5 py-0.5 text-[8px] font-bold rounded ${filter === 'STOCK' ? 'bg-blue-900/50 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>AÇÃO</button>
                            <button onClick={() => setFilter('FII')} className={`px-1.5 py-0.5 text-[8px] font-bold rounded ${filter === 'FII' ? 'bg-emerald-900/50 text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}>FII</button>
                        </div>
                        
                        {/* TOGGLE QUALITY FILTER */}
                        <button 
                            onClick={() => setGoldOnly(!goldOnly)}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-[8px] font-bold border transition-colors ${
                                goldOnly 
                                ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30' 
                                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                            }`}
                            title="Mostrar apenas Oportunidades de Ouro"
                        >
                            {goldOnly ? <Check size={8} /> : <Filter size={8} />}
                            GOLD
                        </button>
                    </div>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-gradient-to-b from-[#080C14] to-[#05070a] relative rounded-b-2xl">
                
                {!hasAccess && (
                    <div className="absolute inset-0 z-20 backdrop-blur-md bg-[#02040a]/60 flex flex-col items-center justify-center p-6 text-center rounded-b-2xl">
                        <div className="w-14 h-14 bg-blue-600/20 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/30 shadow-2xl shadow-blue-500/20">
                            <Crown size={24} className="text-blue-400" fill="currentColor" />
                        </div>
                        <h4 className="text-lg font-black text-white mb-2 uppercase tracking-tight">Scanner Quantitativo</h4>
                        <p className="text-xs text-slate-300 leading-relaxed mb-6 max-w-[220px]">
                            Monitoramento de anomalias matemáticas em tempo real exclusivo para assinantes <strong>Pro</strong>.
                        </p>
                        <button 
                            onClick={() => navigate('/pricing')}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg hover:shadow-blue-600/30 flex items-center justify-center gap-2"
                        >
                            <Zap size={14} fill="currentColor" /> Desbloquear Radar
                        </button>
                    </div>
                )}

                {(hasAccess ? filteredSignals : signals.slice(0, 3)).map((signal, idx) => {
                    const isOpportunity = signal.type === 'OPPORTUNITY';
                    const score = Math.round(signal.score || 0);
                    const isAlgo = signal.source === 'ALGO';
                    const isGold = signal.quality === 'GOLD';
                    
                    return (
                        <div 
                            key={signal.id || idx} 
                            onClick={() => handleSignalClick(signal.ticker)}
                            className={`p-4 rounded-xl border transition-all relative overflow-hidden bg-[#0F131E] border-slate-800 ${hasAccess ? 'cursor-pointer hover:border-slate-600 hover:shadow-lg hover:shadow-purple-900/10' : 'opacity-50 pointer-events-none grayscale'}`}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-black text-sm text-white tracking-wide">{signal.ticker}</span>
                                        <span className="text-[8px] font-bold bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded uppercase">{signal.assetType === 'FII' ? 'Fundo' : 'Ação'}</span>
                                        
                                        {/* BADGE FONTE */}
                                        {isAlgo ? (
                                            <span className="text-[7px] font-black bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/20 uppercase flex items-center gap-1">
                                                <Sparkles size={8} /> Live
                                            </span>
                                        ) : (
                                            <span className="text-[7px] font-black bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 uppercase flex items-center gap-1">
                                                <BookOpen size={8} /> Destaque
                                            </span>
                                        )}
                                        
                                        {/* BADGE QUALIDADE */}
                                        {isAlgo && (
                                            <span className={`text-[7px] font-black px-1.5 py-0.5 rounded border uppercase flex items-center gap-1 ${
                                                isGold 
                                                ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30 shadow-[0_0_8px_rgba(212,175,55,0.2)]' 
                                                : 'bg-slate-300/10 text-slate-300 border-slate-400/30'
                                            }`}>
                                                <Medal size={8} /> {isGold ? 'Ouro' : 'Prata'}
                                            </span>
                                        )}
                                    </div>
                                    {getRiskProfileBadge(signal.riskProfile)}
                                </div>
                                <div className="flex flex-col items-end">
                                    <div className="flex items-center gap-1 mb-1">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase">Potencial</span>
                                        <span className="text-xs font-black text-white">{score}</span>
                                    </div>
                                    <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden">
                                        <div className={`h-full ${getScoreColor(score)}`} style={{ width: `${score}%` }}></div>
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs leading-relaxed mb-3 text-slate-300 border-t border-slate-800/50 pt-2 mt-2">
                                {hasAccess ? signal.message : "Sinal quantitativo oculto."}
                            </p>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                        isOpportunity 
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                                    }`}>
                                        {isOpportunity ? <TrendingUp size={10} /> : <AlertTriangle size={10} />}
                                        {isOpportunity ? 'ALERTA TÉCNICO' : 'RISCO'}
                                    </span>
                                </div>
                                <span className="text-[9px] text-slate-600 font-mono">{signal.time}</span>
                            </div>
                        </div>
                    );
                })}
                
                {hasAccess && isEmpty && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-50 py-10">
                        <Radar size={40} className="text-slate-700 mb-3" />
                        <p className="text-sm font-bold text-slate-500">Nenhuma anomalia {goldOnly ? 'GOLD' : ''} detectada.</p>
                        <p className="text-[10px] text-slate-600 mt-1">O mercado está calmo para este filtro.</p>
                    </div>
                )}
            </div>

            {/* Footer com Histórico */}
            {hasAccess && (
                <div className="p-3 border-t border-slate-800 bg-[#0B101A] rounded-b-2xl">
                    <button 
                        onClick={handleHistoryClick}
                        className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors hover:bg-slate-800 rounded-lg"
                    >
                        <History size={12} /> Ver Histórico Completo
                    </button>
                </div>
            )}
        </div>
    );
};
