
import React from 'react';
import { Wallet, TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, Activity, Layers, BarChart2, Info } from 'lucide-react';
import { useWallet } from '../../contexts/WalletContext';

export const WalletSummary = () => {
    const { kpis, isLoading, isPrivacyMode } = useWallet();

    const formatCurrency = (val: number | null | undefined) => {
        if (isLoading) return null;
        if (isPrivacyMode) return '••••••';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
    };

    const safeFixed = (val: number | null | undefined) => {
        if (isLoading) return null;
        if (isPrivacyMode) return '•••';
        return (val || 0).toFixed(2);
    };

    const isDayPositive = (kpis?.dayVariation || 0) >= 0;
    const isTotalPositive = (kpis?.totalResult || 0) >= 0;
    const isRentabilityPositive = (kpis?.weightedRentability || 0) >= 0;
    const isEquityProfitable = (kpis?.totalEquity || 0) > (kpis?.totalInvested || 0);

    // Cálculo do Retorno Total Bruto (Patrimônio Atual + Proventos Recebidos)
    const totalGross = (kpis?.totalEquity || 0) + (kpis?.totalDividends || 0);
    const grossMultiple = (kpis?.totalInvested || 0) > 0 ? totalGross / kpis.totalInvested : 0;

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-[140px] bg-slate-800/30 rounded-2xl border border-slate-800 animate-pulse"></div>
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            
            {/* 1. PATRIMÔNIO LÍQUIDO */}
            <StatCard 
                title="PATRIMÔNIO LÍQUIDO"
                icon={<Wallet size={16} className="text-blue-400" />}
                mainValue={
                    <span className={isEquityProfitable ? "text-emerald-400" : "text-white"}>
                        {formatCurrency(kpis.totalEquity)}
                    </span>
                }
                footerLabel="VARIAÇÃO HOJE"
                footerValue={
                    <div className={`text-sm font-bold ${isDayPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isDayPositive ? '+' : ''}{formatCurrency(kpis.dayVariation)}
                    </div>
                }
                footerBadge={
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${isDayPositive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                        {isDayPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                        {safeFixed(kpis.dayVariationPercent)}%
                    </span>
                }
                borderColor="group-hover:border-blue-500/30"
            />

            {/* 2. VALOR APLICADO */}
            <StatCard 
                title="VALOR APLICADO"
                icon={<DollarSign size={16} className="text-purple-500" />}
                mainValue={formatCurrency(kpis.totalInvested)}
                footerLabel="Patrimônio + Proventos"
                footerValue={
                    <div className="text-xs text-slate-200 font-bold">
                        {formatCurrency(totalGross)}
                    </div>
                }
                tooltipText="Este múltiplo (ex: 1.28x) representa quantas vezes o seu dinheiro 'retornou'. Cálculo: (Patrimônio Atual + Proventos) ÷ Valor Aplicado."
                footerBadge={
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-purple-500/10 text-purple-400 border-purple-500/20 flex items-center gap-1" title="Múltiplo do Capital Investido">
                        <Activity size={10} />
                        {grossMultiple.toFixed(2)}x
                    </span>
                }
                borderColor="group-hover:border-purple-500/30"
            />

            {/* 3. LUCRO TOTAL */}
            <StatCard 
                title="LUCRO TOTAL"
                icon={<TrendingUp size={16} className={isTotalPositive ? "text-emerald-400" : "text-red-400"} />}
                tooltipText="Este valor refere-se apenas à valorização dos ativos (ganho de capital). Proventos são exibidos separadamente."
                mainValue={
                    <span className={isTotalPositive ? "text-emerald-400" : "text-red-400"}>
                        {isTotalPositive ? '+' : ''}{formatCurrency(kpis.totalResult)}
                    </span>
                }
                footerLabel="Rentabilidade Real (TWRR)"
                footerValue={
                    <div className={`flex items-center gap-1.5 font-bold text-xs ${isRentabilityPositive ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {isRentabilityPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        {safeFixed(kpis.weightedRentability)}%
                    </div>
                }
                footerBadge={
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${isTotalPositive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                        <BarChart2 size={10} />
                        Var. {safeFixed(kpis.totalResultPercent)}%
                    </span>
                }
                borderColor={isTotalPositive ? "group-hover:border-emerald-500/30" : "group-hover:border-red-500/30"}
            />

            {/* 4. PROVENTOS */}
            <StatCard 
                title="PROVENTOS ACUMULADOS"
                icon={<PiggyBank size={16} className="text-[#D4AF37]" />}
                mainValue={formatCurrency(kpis.totalDividends)}
                footerLabel="Média Mensal Est."
                footerValue={
                    <div className="text-xs font-bold text-[#D4AF37]">
                        {formatCurrency(kpis.projectedDividends)}
                    </div>
                }
                footerBadge={
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/20 flex items-center gap-1">
                        <Layers size={10} />
                        Passivo
                    </span>
                }
                borderColor="group-hover:border-[#D4AF37]/30"
            />

        </div>
    );
};

// Componente Visual Reutilizável
interface StatCardProps {
    title: string;
    icon: React.ReactNode;
    mainValue: React.ReactNode;
    footerLabel: string;
    footerValue: React.ReactNode;
    footerBadge?: React.ReactNode;
    borderColor?: string;
    tooltipText?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, icon, mainValue, footerLabel, footerValue, footerBadge, borderColor, tooltipText }) => {
    return (
        <div className={`relative group transition-all duration-300 ${borderColor || 'hover:border-slate-700'}`}>
            {/* Background com Overflow Hidden (Corta o Glow, mas não o Tooltip) */}
            <div className="absolute inset-0 bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden group-hover:bg-[#0B101A] transition-colors">
                {/* Glow Effects (se necessário) poderiam vir aqui */}
            </div>

            {/* Content Container (z-10) - Permite que o tooltip saia pra fora */}
            <div className="relative z-10 p-5 flex flex-col justify-between h-full min-h-[140px]">
                
                {/* Header */}
                <div className="flex items-center justify-between mb-3 relative">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</span>
                        {tooltipText && (
                            <div className="group/info relative flex items-center">
                                <Info size={12} className="text-slate-600 cursor-help hover:text-blue-400 transition-colors" />
                                {/* Tooltip com z-index alto e posicionamento absoluto */}
                                <div className="absolute left-0 top-6 w-48 p-3 bg-[#0F1729] border border-slate-700 rounded-lg shadow-xl z-50 opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none">
                                    <p className="text-[10px] text-slate-300 leading-relaxed font-medium">
                                        {tooltipText}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800 group-hover:border-slate-700 transition-colors">
                        {icon}
                    </div>
                </div>

                {/* Main Value */}
                <div className="mb-4">
                    <h3 className="text-2xl font-bold text-white tracking-tight leading-none truncate">{mainValue}</h3>
                </div>

                {/* Separator */}
                <div className="w-full h-px bg-slate-800 group-hover:bg-slate-700 transition-colors mb-3"></div>

                {/* Footer */}
                <div className="flex items-end justify-between">
                    <div className="flex flex-col">
                        <span className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">{footerLabel}</span>
                        {footerValue}
                    </div>
                    <div>
                        {footerBadge}
                    </div>
                </div>
            </div>
        </div>
    );
};
