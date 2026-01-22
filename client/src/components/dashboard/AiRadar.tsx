
import React from 'react';
import { Radar, Zap, Clock, Lock, TrendingUp, AlertTriangle, Target } from 'lucide-react';
import { AiSignal } from '../../hooks/useDashboardData';
import { useNavigate } from 'react-router-dom';

interface AiRadarProps {
    signals: AiSignal[];
}

export const AiRadar: React.FC<AiRadarProps> = ({ signals }) => {
    const navigate = useNavigate();
    
    // Verifica se há sinais com delay para mostrar o aviso
    const hasDelayedSignals = signals.some(s => s.type === 'DELAYED');
    const isEmpty = signals.length === 0;

    const getImpactColor = (impact: string) => {
        if (impact === 'HIGH') return 'text-purple-400 border-purple-500/30 bg-purple-500/10';
        if (impact === 'MEDIUM') return 'text-blue-400 border-blue-500/30 bg-blue-500/10';
        return 'text-slate-400 border-slate-600/30 bg-slate-600/10';
    };

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[450px]">
            <div className="p-4 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-2">
                    <Radar size={14} className="text-purple-500 animate-spin-slow" />
                    Radar Alpha (Brasil 10)
                </h3>
                {hasDelayedSignals ? (
                    <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 flex items-center gap-1">
                        <Clock size={10} /> Delay 7 Dias
                    </span>
                ) : (
                    <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></span>
                        <span className="text-[9px] font-bold text-purple-500 uppercase">Live</span>
                    </span>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-gradient-to-b from-[#080C14] to-[#05070a]">
                {isEmpty && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                        <Radar size={40} className="text-slate-700 mb-3" />
                        <p className="text-sm font-bold text-slate-500">Aguardando Sinais...</p>
                        <p className="text-xs text-slate-600 max-w-[200px] mt-1">O Neural Engine está compilando dados. Tente novamente em breve.</p>
                    </div>
                )}

                {signals.map((signal) => {
                    const isDelayed = signal.type === 'DELAYED';
                    const isOpportunity = signal.type === 'OPPORTUNITY';
                    
                    return (
                        <div 
                            key={signal.id} 
                            onClick={() => !isDelayed && navigate('/research')}
                            className={`p-4 rounded-xl border transition-all cursor-pointer group relative overflow-hidden ${
                            isDelayed 
                                ? 'bg-slate-900/30 border-slate-800/60 opacity-80 hover:opacity-100' 
                                : 'bg-[#0F131E] border-slate-800 hover:border-slate-600 hover:shadow-lg hover:shadow-purple-900/10'
                        }`}>
                            {/* Header do Card */}
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="font-black text-sm text-white tracking-wide">{signal.ticker}</span>
                                    {signal.thesis && !isDelayed && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-bold uppercase">
                                            {signal.thesis}
                                        </span>
                                    )}
                                </div>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase flex items-center gap-1 ${getImpactColor(signal.impact)}`}>
                                    <Zap size={8} fill="currentColor" /> {signal.impact}
                                </span>
                            </div>
                            
                            {/* Conteúdo Principal */}
                            <p className={`text-xs leading-relaxed mb-3 ${isDelayed ? 'text-slate-500 blur-[0.5px]' : 'text-slate-300'}`}>
                                {signal.message}
                            </p>
                            
                            {/* Footer do Card */}
                            <div className="flex items-center justify-between pt-2 border-t border-slate-800/50">
                                <div className="flex items-center gap-2">
                                    {isDelayed ? (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700 flex items-center gap-1">
                                            <Lock size={8} /> BLOQUEADO
                                        </span>
                                    ) : (
                                        <>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                                                isOpportunity 
                                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                                            }`}>
                                                {isOpportunity ? <TrendingUp size={10} /> : <AlertTriangle size={10} />}
                                                {isOpportunity ? 'COMPRA' : 'RISCO'}
                                            </span>
                                            
                                            {signal.probability && (
                                                <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                                                    <Target size={10} />
                                                    Prob: <span className="text-white">{signal.probability}%</span>
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>
                                <span className="text-[9px] text-slate-600 font-mono">{signal.time}</span>
                            </div>
                        </div>
                    );
                })}
                
                {hasDelayedSignals && (
                    <div className="p-4 text-center bg-gradient-to-b from-blue-900/10 to-blue-900/5 border border-blue-900/30 rounded-xl mt-4 mx-1">
                        <Lock size={16} className="text-blue-400 mx-auto mb-2" />
                        <p className="text-[10px] text-blue-200 mb-3 font-medium leading-relaxed">
                            Membros Essential visualizam sinais com 7 dias de atraso. Obtenha Alpha em tempo real.
                        </p>
                        <button 
                            onClick={() => navigate('/pricing')}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                        >
                            <Zap size={10} fill="currentColor" /> Desbloquear Agora
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
