
import React from 'react';
import { TrendingUp, TrendingDown, Zap, Activity, Wifi, WifiOff, Target } from 'lucide-react';
import { SystemHealth } from '../../hooks/useDashboardData';
import { useWallet } from '../../contexts/WalletContext';

interface EquityData {
    total: number;
    dayChange: number;
    dayPercent: number;
    alpha?: number; // Diferença contra IBOV
}

interface EquitySummaryProps {
    data: EquityData;
    systemHealth?: SystemHealth;
    isLoading?: boolean;
    onGenerateReport?: () => void;
}

export const EquitySummary: React.FC<EquitySummaryProps> = ({ data, systemHealth, isLoading = false, onGenerateReport }) => {
    const { isPrivacyMode } = useWallet();

    const formatCurrency = (val: number) => {
        if (isPrivacyMode) return 'R$ ••••••••';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const alpha = data.alpha || 0;
    const alphaPositive = alpha >= 0;

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* CARD 1: PERFORMANCE TÁTICA */}
            <div className="md:col-span-2 bg-[#080C14] border border-slate-800 rounded-2xl p-6 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                    <Activity size={100} />
                </div>
                
                <div className="flex flex-col h-full justify-between relative z-10">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Performance Hoje</p>
                            
                            {/* Alpha Badge Skeleton vs Real */}
                            {isLoading ? (
                                <div className="h-5 w-24 bg-slate-800 rounded animate-pulse"></div>
                            ) : (
                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-black uppercase border ${alphaPositive ? 'bg-emerald-900/20 text-emerald-400 border-emerald-900/50' : 'bg-red-900/20 text-red-400 border-red-900/50'}`}>
                                    <Target size={12} />
                                    Alpha: {alpha > 0 ? '+' : ''}{alpha}% vs IBOV
                                </div>
                            )}
                        </div>

                        {isLoading ? (
                            <div className="space-y-3 mt-2">
                                <div className="h-10 w-48 bg-slate-800 rounded animate-pulse"></div>
                                <div className="h-4 w-32 bg-slate-800 rounded animate-pulse"></div>
                            </div>
                        ) : (
                            <div className="flex items-baseline gap-3">
                                <h2 className={`text-4xl font-bold tracking-tight ${data.dayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {isPrivacyMode ? '••••••••' : (data.dayChange > 0 ? '+' : '') + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.dayChange)}
                                </h2>
                                <span className={`text-lg font-medium ${data.dayPercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                    ({data.dayPercent > 0 ? '+' : ''}{data.dayPercent}%)
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-800/50 flex items-center justify-between">
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase font-bold">Patrimônio Total</p>
                            {isLoading ? (
                                <div className="h-4 w-24 bg-slate-800 rounded mt-1 animate-pulse"></div>
                            ) : (
                                <p className="text-sm text-slate-300 font-mono">{formatCurrency(data.total)}</p>
                            )}
                        </div>
                        
                        <div className="hidden sm:block w-32">
                            <div className="flex justify-between text-[9px] text-slate-600 mb-1">
                                <span>Min</span>
                                <span>Max (Dia)</span>
                            </div>
                            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                {isLoading ? (
                                    <div className="h-full bg-slate-700 animate-pulse w-full"></div>
                                ) : (
                                    <div className={`h-full w-[60%] rounded-full ${data.dayChange >= 0 ? 'bg-emerald-600' : 'bg-red-600'}`}></div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* CARD 2: SYSTEM HEALTH */}
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition-colors">
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Neural Engine</p>
                        {/* SeisLoading só afeta dados financeiros, SystemHealth pode estar vindo... */}
                        <div className="flex items-center gap-2">
                             {!systemHealth || isLoading ? (
                                <div className="w-16 h-4 bg-slate-800 rounded animate-pulse"></div>
                             ) : (
                                 <>
                                    {systemHealth?.status === 'ONLINE' ? (
                                        <Wifi size={14} className="text-emerald-500" />
                                    ) : (
                                        <WifiOff size={14} className="text-red-500" />
                                    )}
                                    <span className={`text-[9px] font-bold ${
                                        systemHealth?.status === 'ONLINE' ? 'text-emerald-500' : 
                                        systemHealth?.status === 'STALE' ? 'text-yellow-500' : 'text-red-500'
                                    }`}>
                                        {systemHealth?.status || 'CHECKING'}
                                    </span>
                                 </>
                             )}
                        </div>
                    </div>
                    
                    {!systemHealth || isLoading ? (
                        <div className="space-y-2">
                            <div className="h-6 w-3/4 bg-slate-800 rounded animate-pulse"></div>
                            <div className="h-4 w-1/2 bg-slate-800 rounded animate-pulse"></div>
                        </div>
                    ) : (
                        <>
                            <h3 className="text-lg font-bold text-white mb-1">
                                {systemHealth?.message || 'Conectando ao Satellite...'}
                            </h3>
                            
                            <p className="text-xs text-slate-400 font-mono flex items-center gap-2">
                                <Activity size={12} className="text-blue-500" />
                                Latência: {systemHealth?.latencyMs || 0}ms
                            </p>
                            
                            {systemHealth?.lastSync && (
                                <p className="text-[10px] text-slate-600 mt-1">
                                    Último Sync: {new Date(systemHealth.lastSync).toLocaleTimeString()}
                                </p>
                            )}
                        </>
                    )}
                </div>
                
                <button 
                    onClick={onGenerateReport}
                    className="w-full mt-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 hover:text-white group"
                >
                    <Zap size={14} className="text-yellow-400 group-hover:animate-pulse" />
                    Gerar Relatório Instantâneo
                </button>
            </div>
        </div>
    );
};
