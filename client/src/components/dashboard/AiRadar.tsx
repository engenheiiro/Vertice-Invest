
import React from 'react';
import { Radar, Zap, Clock, Lock, TrendingUp, AlertTriangle, Target, Shield, Activity, Crown } from 'lucide-react';
import { AiSignal } from '../../hooks/useDashboardData';
// @ts-ignore
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface AiRadarProps {
    signals: AiSignal[];
    isLoading?: boolean;
}

export const AiRadar: React.FC<AiRadarProps> = ({ signals, isLoading = false }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    
    // VERIFICAÇÃO DE PLANO: Apenas Pro e Black podem ver o Radar
    const hasAccess = user?.plan === 'PRO' || user?.plan === 'BLACK';

    // Se tiver acesso, usa a lógica antiga de delay (fallback). Se não, bloqueia tudo.
    const hasDelayedSignals = signals.some(s => s.type === 'DELAYED');
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
                        Radar Alpha
                    </h3>
                    <span className="text-[9px] font-bold text-slate-500 animate-pulse">BUSCANDO...</span>
                </div>
                <div className="flex-1 p-3 space-y-3 bg-gradient-to-b from-[#080C14] to-[#05070a]">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="p-4 rounded-xl border border-slate-800 bg-[#0F131E] animate-pulse h-24"></div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[450px] relative group">
            <div className="p-4 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-2">
                    <Radar size={14} className="text-purple-500 animate-spin-slow" />
                    Radar Alpha (Brasil 10)
                </h3>
                {hasAccess ? (
                    <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></span>
                        <span className="text-[9px] font-bold text-purple-500 uppercase">Live</span>
                    </span>
                ) : (
                    <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 flex items-center gap-1">
                        <Lock size={10} /> Pro
                    </span>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-gradient-to-b from-[#080C14] to-[#05070a] relative">
                
                {/* BLOQUEIO DE ACESSO (OVERLAY) */}
                {!hasAccess && (
                    <div className="absolute inset-0 z-20 backdrop-blur-md bg-[#02040a]/60 flex flex-col items-center justify-center p-6 text-center">
                        <div className="w-14 h-14 bg-blue-600/20 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/30 shadow-2xl shadow-blue-500/20">
                            <Crown size={24} className="text-blue-400" fill="currentColor" />
                        </div>
                        <h4 className="text-lg font-black text-white mb-2 uppercase tracking-tight">Recurso Pro</h4>
                        <p className="text-xs text-slate-300 leading-relaxed mb-6 max-w-[220px]">
                            O monitoramento de oportunidades em tempo real é exclusivo para assinantes <strong>Pro</strong> e <strong>Black</strong>.
                        </p>
                        <button 
                            onClick={() => navigate('/pricing')}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg hover:shadow-blue-600/30 flex items-center justify-center gap-2"
                        >
                            <Zap size={14} fill="currentColor" /> Desbloquear Radar
                        </button>
                    </div>
                )}

                {/* CONTEÚDO (Visível ou Borrado atrás do overlay) */}
                {(hasAccess ? validSignals : signals.slice(0, 3)).map((signal, idx) => {
                    const isOpportunity = signal.type === 'OPPORTUNITY';
                    const score = signal.score || 0;
                    
                    return (
                        <div 
                            key={signal.id || idx} 
                            onClick={() => hasAccess && navigate('/research')}
                            className={`p-4 rounded-xl border transition-all relative overflow-hidden bg-[#0F131E] border-slate-800 ${hasAccess ? 'cursor-pointer hover:border-slate-600 hover:shadow-lg hover:shadow-purple-900/10' : 'opacity-50 pointer-events-none grayscale'}`}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-black text-sm text-white tracking-wide">{signal.ticker}</span>
                                        {getRiskProfileBadge(signal.riskProfile)}
                                    </div>
                                </div>
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
                            <p className="text-xs leading-relaxed mb-3 text-slate-300 border-t border-slate-800/50 pt-2 mt-2">
                                {hasAccess ? signal.message : "Conteúdo oculto. Atualize seu plano para visualizar a análise completa da IA."}
                            </p>
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
                                </div>
                                <span className="text-[9px] text-slate-600 font-mono">{signal.time}</span>
                            </div>
                        </div>
                    );
                })}
                
                {hasAccess && isEmpty && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-50 py-10">
                        <Radar size={40} className="text-slate-700 mb-3" />
                        <p className="text-sm font-bold text-slate-500">Aguardando Sinais...</p>
                    </div>
                )}
            </div>
        </div>
    );
};
