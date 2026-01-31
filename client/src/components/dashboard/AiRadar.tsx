
import React from 'react';
import { Radar, Zap, Clock, Lock, TrendingUp, AlertTriangle, Target, Shield, Activity } from 'lucide-react';
import { AiSignal } from '../../hooks/useDashboardData';
import { useNavigate } from 'react-router-dom';

interface AiRadarProps {
    signals: AiSignal[];
    isLoading?: boolean; // Nova prop
}

export const AiRadar: React.FC<AiRadarProps> = ({ signals, isLoading = false }) => {
    const navigate = useNavigate();
    
    // Verifica se há sinais com delay para mostrar o aviso
    const hasDelayedSignals = signals.some(s => s.type === 'DELAYED');
    
    // Filtra para exibir apenas sinais reais (ou nada, se todos forem delayed)
    const validSignals = signals.filter(s => s.type !== 'DELAYED');
    const isEmpty = validSignals.length === 0 && !hasDelayedSignals;

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'bg-emerald-500';
        if (score >= 60) return 'bg-yellow-500';
        return 'bg-red-500';
    };

    const getRiskProfileBadge = (profile?: string) => {
        if (!profile) return null;
        if (profile === 'DEFENSIVE') return <span className="text-[8px] font-bold text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded border border-emerald-900/50 flex items-center gap-1 uppercase"><Shield size={8} /> Defensivo</span>;
        if (profile === 'MODERATE') return <span className="text-[8px] font-bold text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded border border-blue-900/50 flex items-center gap-1 uppercase"><Activity size={8} /> Moderado</span>;
        return <span className="text-[8px] font-bold text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded border border-purple-900/50 flex items-center gap-1 uppercase"><Zap size={8} /> Arrojado</span>;
    };

    // --- SKELETON UI ---
    if (isLoading) {
        return (
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[450px]">
                <div className="p-4 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                    <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-2">
                        <Radar size={14} className="text-purple-500 animate-spin-slow" />
                        Radar Alpha (Brasil 10)
                    </h3>
                    <span className="text-[9px] font-bold text-slate-500 animate-pulse">BUSCANDO...</span>
                </div>
                <div className="flex-1 p-3 space-y-3 custom-scrollbar bg-gradient-to-b from-[#080C14] to-[#05070a]">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="p-4 rounded-xl border border-slate-800 bg-[#0F131E] animate-pulse">
                            <div className="flex justify-between items-start mb-3">
                                <div className="space-y-2">
                                    <div className="h-4 w-16 bg-slate-800 rounded"></div>
                                    <div className="h-3 w-24 bg-slate-800 rounded"></div>
                                </div>
                                <div className="h-8 w-8 bg-slate-800 rounded-full"></div>
                            </div>
                            <div className="space-y-2 mb-4">
                                <div className="h-2 w-full bg-slate-800 rounded"></div>
                                <div className="h-2 w-2/3 bg-slate-800 rounded"></div>
                            </div>
                            <div className="flex justify-between">
                                <div className="h-4 w-12 bg-slate-800 rounded"></div>
                                <div className="h-4 w-10 bg-slate-800 rounded"></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[450px]">
            <div className="p-4 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-2">
                    <Radar size={14} className="text-purple-500 animate-spin-slow" />
                    Radar Alpha (Brasil 10)
                </h3>
                {hasDelayedSignals ? (
                    <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 flex items-center gap-1">
                        <Lock size={10} /> Conteúdo Protegido
                    </span>
                ) : (
                    <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></span>
                        <span className="text-[9px] font-bold text-purple-500 uppercase">Live</span>
                    </span>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-gradient-to-b from-[#080C14] to-[#05070a]">
                
                {/* Caso 1: Sinais Reais (Pro/Black) */}
                {validSignals.map((signal) => {
                    const isOpportunity = signal.type === 'OPPORTUNITY';
                    const score = signal.score || 0;
                    
                    return (
                        <div 
                            key={signal.id} 
                            onClick={() => navigate('/research')}
                            className="p-4 rounded-xl border transition-all cursor-pointer group relative overflow-hidden bg-[#0F131E] border-slate-800 hover:border-slate-600 hover:shadow-lg hover:shadow-purple-900/10"
                        >
                            {/* Header do Card */}
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-black text-sm text-white tracking-wide">{signal.ticker}</span>
                                        {getRiskProfileBadge(signal.riskProfile)}
                                    </div>
                                    {signal.thesis && (
                                        <span className="text-[9px] text-slate-500 font-medium uppercase">
                                            {signal.thesis}
                                        </span>
                                    )}
                                </div>
                                
                                {/* Score Badge Visual */}
                                <div className="flex flex-col items-end">
                                    <div className="flex items-center gap-1 mb-1">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase">Score</span>
                                        <span className="text-xs font-black text-white">{score}</span>
                                    </div>
                                    <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden">
                                        <div className={`h-full ${getScoreColor(score)}`} style={{ width: `${score}%` }}></div>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Conteúdo Principal */}
                            <p className="text-xs leading-relaxed mb-3 text-slate-300 border-t border-slate-800/50 pt-2 mt-2">
                                {signal.message}
                            </p>
                            
                            {/* Footer do Card */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                        isOpportunity 
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                                    }`}>
                                        {isOpportunity ? <TrendingUp size={10} /> : <AlertTriangle size={10} />}
                                        {isOpportunity ? 'COMPRA' : 'RISCO'}
                                    </span>
                                    
                                    {signal.probability && (
                                        <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1 ml-1">
                                            <Target size={10} />
                                            Prob: <span className="text-white">{signal.probability}%</span>
                                        </span>
                                    )}
                                </div>
                                <span className="text-[9px] text-slate-600 font-mono">{signal.time}</span>
                            </div>
                        </div>
                    );
                })}
                
                {/* Caso 2: Delayed Signals (Mostrar Card de Upgrade Único) */}
                {hasDelayedSignals && (
                    <div className="h-full flex flex-col items-center justify-center p-6 text-center border border-dashed border-slate-800 rounded-xl bg-slate-900/20">
                        <div className="w-12 h-12 bg-blue-900/20 rounded-full flex items-center justify-center mb-4 border border-blue-900/40">
                            <Lock size={20} className="text-blue-400" />
                        </div>
                        <h4 className="text-sm font-bold text-white mb-2">Sinais de Alpha Bloqueados</h4>
                        <p className="text-xs text-slate-400 leading-relaxed mb-6 max-w-[200px]">
                            O Neural Engine detectou {signals.length} oportunidades de mercado hoje. Atualize seu plano para visualizar em tempo real.
                        </p>
                        <button 
                            onClick={() => navigate('/pricing')}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                        >
                            <Zap size={12} fill="currentColor" /> Desbloquear Acesso Pro
                        </button>
                    </div>
                )}

                {/* Caso 3: Vazio Total */}
                {isEmpty && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                        <Radar size={40} className="text-slate-700 mb-3" />
                        <p className="text-sm font-bold text-slate-500">Aguardando Sinais...</p>
                        <p className="text-xs text-slate-600 max-w-[200px] mt-1">O Neural Engine está compilando dados. Tente novamente em breve.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
