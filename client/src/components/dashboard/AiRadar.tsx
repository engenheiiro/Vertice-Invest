import React from 'react';
import { Radar, Zap, Clock, Lock } from 'lucide-react';
import { AiSignal } from '../../hooks/useDashboardData';
import { useNavigate } from 'react-router-dom';

interface AiRadarProps {
    signals: AiSignal[];
}

export const AiRadar: React.FC<AiRadarProps> = ({ signals }) => {
    const navigate = useNavigate();
    
    // Verifica se há sinais com delay para mostrar o aviso
    const hasDelayedSignals = signals.some(s => s.type === 'DELAYED');

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[400px]">
            <div className="p-4 border-b border-slate-800 bg-[#0B101A] flex items-center justify-between">
                <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-2">
                    <Radar size={14} className="text-purple-500 animate-spin-slow" />
                    Radar Alpha
                </h3>
                {hasDelayedSignals ? (
                    <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 flex items-center gap-1">
                        <Clock size={10} /> 1 Sem. Delay
                    </span>
                ) : (
                    <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></span>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {signals.map((signal) => {
                    const isDelayed = signal.type === 'DELAYED';
                    
                    return (
                        <div key={signal.id} className={`p-3 rounded-xl border transition-all cursor-pointer group relative overflow-hidden ${
                            isDelayed 
                                ? 'bg-slate-900/30 border-slate-800 opacity-70 hover:opacity-100 grayscale' 
                                : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                        }`}>
                            <div className="flex justify-between items-start mb-2">
                                <span className="font-bold text-sm text-white">{signal.ticker}</span>
                                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                    {isDelayed && <Clock size={10} />}
                                    {signal.time}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 leading-snug mb-2 group-hover:text-slate-300 transition-colors">
                                {signal.message}
                            </p>
                            
                            <div className="flex items-center gap-2">
                                {isDelayed ? (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700 flex items-center gap-1">
                                        <Lock size={8} /> SINAL PASSADO
                                    </span>
                                ) : (
                                    <>
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                            signal.type === 'OPPORTUNITY' 
                                                ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                                                : 'bg-red-500/10 text-red-400 border-red-500/20'
                                        }`}>
                                            {signal.type === 'OPPORTUNITY' ? 'OPORTUNIDADE' : 'RISCO'}
                                        </span>
                                        {signal.impact === 'HIGH' && (
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                                                <Zap size={8} /> HIGH IMPACT
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
                
                {hasDelayedSignals && (
                    <div className="p-3 text-center bg-blue-900/10 border border-blue-900/30 rounded-xl mt-2">
                        <p className="text-[10px] text-blue-200 mb-2 font-medium">Você está vendo dados históricos.</p>
                        <button 
                            onClick={() => navigate('/pricing')}
                            className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase tracking-wider rounded transition-colors flex items-center justify-center gap-2"
                        >
                            <Zap size={10} /> Desbloquear Real-Time
                        </button>
                    </div>
                )}
            </div>
            
            <div className="p-3 border-t border-slate-800 bg-[#0B101A]">
                <button className="w-full py-2 text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors hover:bg-slate-800 rounded-lg">
                    Ver Todos os Sinais
                </button>
            </div>
        </div>
    );
};