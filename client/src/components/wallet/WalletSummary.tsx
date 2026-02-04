
import React from 'react';
import { Wallet, TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, Layers, Activity } from 'lucide-react';
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
            
            {/* 1. PATRIMÔNIO TOTAL */}
            <StatCard 
                title="PATRIMÔNIO TOTAL"
                icon={<Wallet size={16} className="text-blue-400" />}
                mainValue={formatCurrency(kpis.totalEquity)}
                footerLabel="Variação (Hoje)"
                footerValue={
                    <div className={`flex items-center gap-1.5 font-bold text-xs ${isDayPositive ? 'text-emerald-400' : 'text-red-400'}`}>
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

            {/* 2. VALOR APLICADO (Limpo) */}
            <StatCard 
                title="VALOR APLICADO"
                icon={<DollarSign size={16} className="text-purple-500" />}
                mainValue={formatCurrency(kpis.totalInvested)}
                footerLabel="Base de Custo"
                footerValue={
                    <div className="text-xs text-slate-400 font-medium">Aportes Totais</div>
                }
                footerBadge={
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-slate-800 text-slate-400 border-slate-700 flex items-center gap-1">
                        <Activity size={10} />
                        Acumulado
                    </span>
                }
                borderColor="group-hover:border-purple-500/30"
            />

            {/* 3. RENTABILIDADE (Enriquecido com ROI e Resultado) */}
            <StatCard 
                title="RENTABILIDADE"
                icon={<TrendingUp size={16} className={isRentabilityPositive ? "text-emerald-400" : "text-red-400"} />}
                mainValue={
                    <span className={isRentabilityPositive ? "text-emerald-400" : "text-red-400"}>
                        {isRentabilityPositive ? '+' : ''}{safeFixed(kpis.weightedRentability)}%
                    </span>
                }
                footerLabel="Resultado Nominal"
                footerValue={
                    <div className={`flex items-center gap-1.5 font-bold text-xs ${isTotalPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isTotalPositive ? '+' : ''}{formatCurrency(kpis.totalResult)}
                    </div>
                }
                footerBadge={
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1 ${isTotalPositive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                        {isRentabilityPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                        ROI {safeFixed(kpis.totalResultPercent)}%
                    </span>
                }
                borderColor={isRentabilityPositive ? "group-hover:border-emerald-500/30" : "group-hover:border-red-500/30"}
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

// Componente Visual Reutilizável e Estrito
interface StatCardProps {
    title: string;
    icon: React.ReactNode;
    mainValue: React.ReactNode;
    footerLabel: string;
    footerValue: React.ReactNode;
    footerBadge: React.ReactNode;
    borderColor?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, icon, mainValue, footerLabel, footerValue, footerBadge, borderColor }) => {
    return (
        <div className={`bg-[#080C14] border border-slate-800 rounded-2xl p-5 flex flex-col justify-between group transition-all duration-300 hover:bg-[#0B101A] ${borderColor || 'group-hover:border-slate-700'}`}>
            
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</span>
                <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800 group-hover:border-slate-700 transition-colors">
                    {icon}
                </div>
            </div>

            {/* Main Value */}
            <div className="mb-4">
                <h3 className="text-2xl font-bold text-white tracking-tight leading-none">{mainValue}</h3>
            </div>

            {/* Separator */}
            <div className="w-full h-px bg-slate-800 group-hover:bg-slate-700 transition-colors mb-3"></div>

            {/* Footer */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">{footerLabel}</span>
                    {footerValue}
                </div>
                <div>
                    {footerBadge}
                </div>
            </div>
        </div>
    );
};
