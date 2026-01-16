import React from 'react';
import { TrendingUp, ArrowUpRight, Zap } from 'lucide-react';

interface EquityData {
    total: number;
    dayChange: number;
    dayPercent: number;
}

interface EquitySummaryProps {
    data: EquityData;
}

export const EquitySummary: React.FC<EquitySummaryProps> = ({ data }) => {
    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Equity Card */}
            <div className="md:col-span-2 bg-[#080C14] border border-slate-800 rounded-2xl p-6 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                    <TrendingUp size={100} />
                </div>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Patrimônio Líquido</p>
                <div className="flex items-baseline gap-4">
                    <h2 className="text-4xl font-bold text-white tracking-tight">{formatCurrency(data.total)}</h2>
                    <div className="flex items-center gap-1 text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded text-sm font-bold border border-emerald-500/20">
                        <ArrowUpRight size={14} />
                        {data.dayPercent}%
                    </div>
                </div>
                <p className="text-slate-500 text-xs mt-2 font-mono">
                    {data.dayChange > 0 ? '+' : ''}{formatCurrency(data.dayChange)} (Hoje)
                </p>
                
                {/* Mini Chart Decoration */}
                <div className="h-1 w-full bg-slate-800 mt-6 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-600 to-emerald-500 w-[70%] animate-pulse"></div>
                </div>
            </div>

            {/* Quick Action / Alerts */}
            <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition-colors">
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Status do Sistema</p>
                        <div className="flex items-center gap-2">
                             <span className="text-[9px] text-green-500 font-bold">ONLINE</span>
                             <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                        </div>
                    </div>
                    <h3 className="text-lg font-bold text-white">Neural Engine Ativo</h3>
                    <p className="text-xs text-slate-400 mt-1">Analisando 14TB de dados/seg.</p>
                </div>
                <button className="w-full mt-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 hover:text-white">
                    <Zap size={14} className="text-yellow-400" />
                    Ver Relatório Diário
                </button>
            </div>
        </div>
    );
};