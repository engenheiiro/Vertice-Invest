
import React from 'react';
import { Wallet, TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, Percent } from 'lucide-react';
import { useWallet } from '../../contexts/WalletContext';

export const WalletSummary = () => {
    const { kpis, isLoading } = useWallet();

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    if (isLoading) {
        return <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
            {[...Array(4)].map((_, i) => (
                <div key={i} className="h-32 bg-slate-800/50 rounded-2xl"></div>
            ))}
        </div>;
    }

    // Calcula se a carteira está positiva ou negativa
    const isProfitable = kpis.totalResult >= 0;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            
            {/* Patrimônio Total */}
            <SummaryCard 
                icon={<Wallet className="text-blue-400" size={20} />}
                title="Patrimônio Total"
                value={formatCurrency(kpis.totalEquity)}
                subValue={
                    <span className={`flex items-center text-xs font-bold ${kpis.dayVariation >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {kpis.dayVariation >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        {kpis.dayVariationPercent.toFixed(2)}% (Hoje)
                    </span>
                }
                glowColor="blue"
                borderColor="border-blue-500/20"
            />

            {/* Valor Aplicado (Custo) */}
            <SummaryCard 
                icon={<DollarSign className="text-emerald-400" size={20} />}
                title="Valor Aplicado"
                value={formatCurrency(kpis.totalInvested)}
                subValue={<span className="text-slate-500 text-xs">Custo de Aquisição</span>}
                glowColor="emerald"
                borderColor="border-emerald-500/20"
            />

            {/* Rentabilidade Geral (Substitui Lucro Total antigo para focar em %) */}
            <SummaryCard 
                icon={<Percent className={isProfitable ? "text-purple-400" : "text-red-400"} size={20} />}
                title="Rentabilidade Geral"
                value={`${isProfitable ? '+' : ''}${kpis.totalResultPercent.toFixed(2)}%`}
                subValue={
                    <span className={`text-xs font-bold ${isProfitable ? 'text-purple-400' : 'text-red-500'}`}>
                        {isProfitable ? '+' : ''}{formatCurrency(kpis.totalResult)}
                    </span>
                }
                glowColor="purple"
                borderColor="border-purple-500/20"
            />

            {/* Proventos (Dividendos) */}
            <SummaryCard 
                icon={<PiggyBank className="text-[#D4AF37]" size={20} />}
                title="Proventos Acumulados"
                value={formatCurrency(kpis.totalDividends)}
                subValue={<span className="text-slate-500 text-xs">Histórico Total</span>}
                borderColor="border-[#D4AF37]/20"
                glowColor="gold"
            />
        </div>
    );
};

interface SummaryCardProps {
    icon: React.ReactNode;
    title: string;
    value: string;
    subValue?: React.ReactNode;
    glowColor?: 'blue' | 'emerald' | 'red' | 'gold' | 'purple';
    borderColor?: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ icon, title, value, subValue, glowColor, borderColor }) => {
    return (
        <div className={`bg-[#080C14] border ${borderColor || 'border-slate-800'} rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition-colors`}>
            {glowColor && (
                <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-[60px] opacity-10 group-hover:opacity-20 transition-opacity
                    ${glowColor === 'blue' ? 'bg-blue-600' : ''}
                    ${glowColor === 'emerald' ? 'bg-emerald-600' : ''}
                    ${glowColor === 'red' ? 'bg-red-600' : ''}
                    ${glowColor === 'gold' ? 'bg-[#D4AF37]' : ''}
                    ${glowColor === 'purple' ? 'bg-purple-600' : ''}
                `}></div>
            )}
            
            <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-slate-900 rounded-lg border border-slate-800/50">
                        {icon}
                    </div>
                </div>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
                <h3 className="text-2xl font-bold text-white tracking-tight mb-1">{value}</h3>
                <div>{subValue}</div>
            </div>
        </div>
    );
};
