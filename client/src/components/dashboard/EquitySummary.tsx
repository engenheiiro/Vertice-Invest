
import React from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { Wallet, TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, Activity, Layers, Target, Zap } from 'lucide-react';

interface EquitySummaryProps {
    onGenerateReport?: () => void; // Mantido para compatibilidade
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

    return (
        <div className="col-span-1 md:col-span-3">
            {/* Container Principal: Grid 4 Colunas (XL) ou 2 Colunas (MD) */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                
                {/* 1. PATRIMÔNIO (Destaque) */}
                <DashboardCard 
                    label="Patrimônio Líquido"
                    value={formatCurrency(kpis.totalEquity)}
                    icon={<Wallet size={18} className="text-blue-500" />}
                    subLabel="Variação Hoje"
                    subContent={
                        <div className={`flex items-center gap-1 font-bold ${isDayPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isDayPositive ? '+' : ''}{formatCurrency(kpis.dayVariation)}
                        </div>
                    }
                    badge={
                        <Badge value={`${safeFixed(kpis.dayVariationPercent)}%`} isPositive={isDayPositive} />
                    }
                    glow="blue"
                />

                {/* 2. VALOR APLICADO (Padronizado) */}
                <DashboardCard 
                    label="Valor Aplicado"
                    value={formatCurrency(kpis.totalInvested)}
                    icon={<DollarSign size={18} className="text-purple-500" />}
                    subLabel="Base de Custo"
                    subContent={
                        <span className="text-slate-300 font-medium">Aportes Totais</span>
                    }
                    badge={
                        <div className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-800 text-slate-400 border-slate-700 flex items-center gap-1">
                            <Activity size={10} /> Acumulado
                        </div>
                    }
                />

                {/* 3. RENTABILIDADE (Com ROI e Resultado) */}
                <DashboardCard 
                    label="Rentabilidade"
                    value={
                        <span className={isRentabilityPositive ? "text-emerald-400" : "text-red-400"}>
                            {isRentabilityPositive ? '+' : ''}{safeFixed(kpis.weightedRentability)}%
                        </span>
                    }
                    icon={<TrendingUp size={18} className={isRentabilityPositive ? "text-emerald-500" : "text-red-500"} />}
                    subLabel="Resultado Nominal"
                    subContent={
                        <div className={`flex items-center gap-1 font-bold ${isTotalPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isTotalPositive ? '+' : ''}{formatCurrency(kpis.totalResult)}
                        </div>
                    }
                    badge={
                        <div className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${isTotalPositive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                            ROI {safeFixed(kpis.totalResultPercent)}%
                        </div>
                    }
                />

                {/* 4. PROVENTOS (Label Abreviada) */}
                <DashboardCard 
                    label="Prov. Acumulados"
                    value={formatCurrency(kpis.totalDividends)}
                    icon={<PiggyBank size={18} className="text-[#D4AF37]" />}
                    subLabel="Média Mensal"
                    subContent={
                        <span className="text-[#D4AF37] font-bold">{formatCurrency(kpis.projectedDividends)}</span>
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

// Componente Visual Interno (Dashboard Specific)
const DashboardCard = ({ label, value, icon, subLabel, subContent, badge, glow }: any) => (
    <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition-colors">
        {glow === 'blue' && <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/5 rounded-full blur-[60px] pointer-events-none"></div>}
        {glow === 'gold' && <div className="absolute top-0 right-0 w-32 h-32 bg-[#D4AF37]/5 rounded-full blur-[60px] pointer-events-none"></div>}
        
        <div className="relative z-10">
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800 group-hover:border-slate-600 transition-colors">
                        {icon}
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
                </div>
            </div>

            <div className="mt-2 mb-4">
                <h3 className="text-2xl font-bold text-white tracking-tight">{value}</h3>
            </div>

            <div className="w-full h-px bg-slate-800/80 mb-3"></div>

            <div className="flex items-center justify-between">
                <div>
                    <p className="text-[9px] text-slate-500 uppercase font-bold mb-0.5">{subLabel}</p>
                    <div className="text-xs">{subContent}</div>
                </div>
                <div>{badge}</div>
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
