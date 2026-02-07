
import React from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { Wallet, TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, Activity, Layers, BarChart2, Info } from 'lucide-react';

interface EquitySummaryProps {
    onGenerateReport?: () => void; 
}

export const EquitySummary: React.FC<EquitySummaryProps> = () => {
    const { kpis, isPrivacyMode, isLoading } = useWallet();

    const formatCurrency = (val: number | null | undefined) => {
        if (isLoading) return <div className="h-6 w-24 bg-slate-800 rounded animate-pulse"></div>;
        if (isPrivacyMode) return '••••••';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
    };

    const safeFixed = (val: number | null | undefined) => {
        if (isLoading) return '...';
        if (isPrivacyMode) return '•••';
        return (val || 0).toFixed(2);
    };

    const isDayPositive = (kpis?.dayVariation || 0) >= 0;
    const isTotalPositive = (kpis?.totalResult || 0) >= 0;
    const isRentabilityPositive = (kpis?.weightedRentability || 0) >= 0;
    const isEquityProfitable = (kpis?.totalEquity || 0) > (kpis?.totalInvested || 0);

    // Cálculo do Retorno Total Bruto
    const totalGross = (kpis?.totalEquity || 0) + (kpis?.totalDividends || 0);
    const grossMultiple = (kpis?.totalInvested || 0) > 0 ? totalGross / kpis.totalInvested : 0;

    return (
        <div className="col-span-1 md:col-span-3">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                
                {/* 1. PATRIMÔNIO LÍQUIDO */}
                <DashboardCard 
                    label="PATRIMÔNIO LÍQUIDO"
                    icon={<Wallet size={18} className="text-blue-500" />}
                    value={
                        <div className="flex items-baseline gap-2">
                            <span className={isEquityProfitable ? "text-emerald-400" : "text-white"}>
                                {formatCurrency(kpis.totalEquity)}
                            </span>
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded border translate-y-[-2px] ${isTotalPositive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                {isTotalPositive ? '+' : ''}{safeFixed(kpis.totalResultPercent)}%
                            </span>
                        </div>
                    }
                    subLabel="VARIAÇÃO HOJE"
                    subContent={
                        <div className={`text-sm font-bold ${isDayPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isDayPositive ? '+' : ''}{formatCurrency(kpis.dayVariation)}
                        </div>
                    }
                    badge={
                        <Badge value={`${safeFixed(kpis.dayVariationPercent)}%`} isPositive={isDayPositive} />
                    }
                    glow="blue"
                />

                {/* 2. VALOR APLICADO */}
                <DashboardCard 
                    label="VALOR APLICADO"
                    value={formatCurrency(kpis.totalInvested)}
                    icon={<DollarSign size={18} className="text-purple-500" />}
                    subLabel="Patrimônio + Proventos"
                    subContent={
                        <span className="text-slate-200 font-bold text-xs">{formatCurrency(totalGross)}</span>
                    }
                    badge={
                        <div className="text-[10px] font-bold px-2 py-0.5 rounded border bg-purple-500/10 text-purple-400 border-purple-500/20 flex items-center gap-1">
                            <Activity size={10} /> {grossMultiple.toFixed(2)}x
                        </div>
                    }
                />

                {/* 3. LUCRO TOTAL */}
                <DashboardCard 
                    label="LUCRO TOTAL"
                    icon={<TrendingUp size={18} className={isTotalPositive ? "text-emerald-500" : "text-red-500"} />}
                    tooltipText="Este valor refere-se apenas à valorização dos ativos. Proventos são exibidos separadamente."
                    value={
                        <span className={isTotalPositive ? "text-emerald-400" : "text-red-400"}>
                            {isTotalPositive ? '+' : ''}{formatCurrency(kpis.totalResult)}
                        </span>
                    }
                    subLabel="Rentabilidade Real (TWRR)"
                    subContent={
                        <div className={`flex items-center gap-1 text-xs font-bold ${isRentabilityPositive ? 'text-emerald-400' : 'text-slate-400'}`}>
                            {isRentabilityPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                            {safeFixed(kpis.weightedRentability)}%
                        </div>
                    }
                    badge={
                        <div className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${isTotalPositive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                            <BarChart2 size={10} />
                            Var. {safeFixed(kpis.totalResultPercent)}%
                        </div>
                    }
                />

                {/* 4. PROVENTOS */}
                <DashboardCard 
                    label="PROV. ACUMULADOS"
                    value={formatCurrency(kpis.totalDividends)}
                    icon={<PiggyBank size={18} className="text-[#D4AF37]" />}
                    subLabel="Média Mensal Est."
                    subContent={
                        <span className="text-[#D4AF37] font-bold text-xs">{formatCurrency(kpis.projectedDividends)}</span>
                    }
                    badge={
                        <div className="text-[10px] font-bold px-2 py-0.5 rounded border bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/20 flex items-center gap-1">
                            <Layers size={10} /> Passivo
                        </div>
                    }
                    glow="gold"
                />

            </div>
        </div>
    );
};

// Componente Visual Interno (Dashboard Specific) - Refatorado para Overflow
const DashboardCard = ({ label, value, icon, subLabel, subContent, badge, glow, tooltipText }: any) => (
    <div className="relative group hover:border-slate-700 transition-colors">
        {/* Background Container (Clipped) */}
        <div className="absolute inset-0 bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden">
            {glow === 'blue' && <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/5 rounded-full blur-[60px] pointer-events-none"></div>}
            {glow === 'gold' && <div className="absolute top-0 right-0 w-32 h-32 bg-[#D4AF37]/5 rounded-full blur-[60px] pointer-events-none"></div>}
        </div>

        {/* Content Container (Allows Overflow for Tooltip) */}
        <div className="relative z-10 p-5 h-full flex flex-col justify-between">
            <div>
                <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800 group-hover:border-slate-600 transition-colors">
                            {icon}
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
                            {tooltipText && (
                                <div className="group/info relative flex items-center">
                                    <Info size={10} className="text-slate-600 cursor-help hover:text-blue-400 transition-colors" />
                                    <div className="absolute left-0 top-6 w-48 p-2 bg-[#0F1729] border border-slate-700 rounded-lg shadow-xl z-50 opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none">
                                        <p className="text-[10px] text-slate-300 leading-relaxed font-medium">
                                            {tooltipText}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-2 mb-4">
                    <h3 className="text-2xl font-bold text-white tracking-tight truncate">{value}</h3>
                </div>
            </div>

            <div>
                <div className="w-full h-px bg-slate-800/80 mb-3"></div>

                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[9px] text-slate-500 uppercase font-bold mb-0.5">{subLabel}</p>
                        {subContent}
                    </div>
                    <div>{badge}</div>
                </div>
            </div>
        </div>
    </div>
);

const Badge = ({ value, isPositive }: { value: string, isPositive: boolean }) => (
    <div className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${isPositive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
        {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
        {value}
    </div>
);
