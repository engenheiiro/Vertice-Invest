
import React from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { Wallet, TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, Activity, Layers, Info, ShieldCheck, AlertTriangle, Scale, Minus } from 'lucide-react';
import { SkeletonKpiGrid, FitText, PrivacyToggle } from '../ui'; // (I12) skeleton padronizado + auto-fit de valor
import { formatCurrency as fmtCurrency } from '../../utils/format';
import { useCountUp } from '../../hooks/useCountUp';

interface EquitySummaryProps {
    onGenerateReport?: () => void;
}

export const WalletSummary: React.FC<EquitySummaryProps> = () => {
    const { kpis, isPrivacyMode, togglePrivacyMode, isLoading } = useWallet();
    const animatedEquity = useCountUp(kpis?.totalEquity || 0);

    const formatCurrency = (val: number | null | undefined) => fmtCurrency(val, 'BRL', { privacy: isPrivacyMode });

    const safeFixed = (val: number | null | undefined) => {
        if (isPrivacyMode) return '•••';
        return (val || 0).toFixed(2);
    };

    const isDayPositive = (kpis?.dayVariation || 0) >= 0;
    const isDayFlat = (kpis?.dayVariation || 0) === 0;
    const isTotalPositive = (kpis?.totalResult || 0) >= 0;
    const isRentabilityPositive = (kpis?.weightedRentability || 0) >= 0;

    // Badge do Patrimônio Líquido = variação do CAPITAL (patrimônio vs. investido),
    // não o retorno total. O retorno total (com proventos) fica no card Lucro Total.
    const capitalVariationPercent = (kpis?.totalInvested || 0) > 0
        ? (((kpis?.totalEquity || 0) - (kpis?.totalInvested || 0)) / kpis.totalInvested) * 100
        : 0;
    const isCapitalPositive = capitalVariationPercent >= 0;
    const isAudited = kpis?.dataQuality === 'AUDITED';

    // Retorno Total Bruto (patrimônio + proventos) e múltiplo sobre o aplicado.
    const totalGross = (kpis?.totalEquity || 0) + (kpis?.totalDividends || 0);
    const grossMultiple = (kpis?.totalInvested || 0) > 0 ? totalGross / kpis.totalInvested : 0;

    if (isLoading) {
        return <SkeletonKpiGrid count={4} className="mb-8" />;
    }

    return (
        // (A7) região nomeada para os indicadores patrimoniais (landmark)
        <section aria-label="Resumo patrimonial" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">

            {/* 1. PATRIMÔNIO LÍQUIDO — card "herói" em gradiente verde (destaque da carteira) */}
            {/* Card sempre verde-escuro nos DOIS temas → texto sempre branco. Usamos valores
                arbitrários (text-[#fff], rgba…) porque o tema claro sobrescreve .text-white
                e .text-white/xx para tons escuros — o que apagaria o texto sobre o verde. */}
            <div
                className="relative overflow-hidden rounded-2xl p-[18px] text-[#fff]"
                style={{
                    background: 'linear-gradient(180deg, #0f5f47, #0c4f3b)',
                    boxShadow: '0 14px 30px -18px rgba(12,79,59,.9)',
                }}
            >
                <div
                    className="absolute right-[-30px] top-[-30px] w-[130px] h-[130px] rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(255,255,255,.14), transparent 70%)' }}
                />
                <div className="relative flex justify-between items-start">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[rgba(255,255,255,0.72)]">Patrimônio Líquido</span>
                        <PrivacyToggle
                            isPrivacyMode={isPrivacyMode}
                            onToggle={togglePrivacyMode}
                            size={14}
                            className="p-1 hover:bg-white/[0.14] rounded-lg text-[rgba(255,255,255,0.6)] hover:text-[rgba(255,255,255,0.9)] transition-colors"
                        />
                    </div>
                    <span className="w-[30px] h-[30px] rounded-[9px] bg-white/[0.14] flex items-center justify-center text-[#eafff6]">
                        <Wallet size={16} />
                    </span>
                </div>

                <div className="relative flex items-baseline gap-2 mt-3.5">
                    <FitText
                        className="flex-1 font-extrabold tracking-tight"
                        max={28}
                        min={15}
                        aria-live="polite"
                        aria-atomic={true}
                    >
                        {formatCurrency(animatedEquity)}
                    </FitText>
                    <span
                        className={`shrink-0 text-xs font-bold ${isCapitalPositive ? 'text-[#8ff0c8]' : 'text-[#fca5a5]'}`}
                        title="Variação do capital: patrimônio atual vs. valor investido (sem proventos)."
                    >
                        {isCapitalPositive ? '+' : ''}{safeFixed(capitalVariationPercent)}%
                    </span>
                </div>

                <div className="relative flex items-center justify-between mt-4 pt-3 border-t border-white/[0.14]">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-[rgba(255,255,255,0.6)] mb-0.5">Variação Hoje</p>
                        <div className="text-sm font-bold text-[#fff]">
                            {isDayPositive ? '+' : ''}{formatCurrency(kpis.dayVariation)}
                        </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#eafff6] bg-white/[0.14] px-2.5 py-1 rounded-full">
                        {isDayFlat ? <Minus size={12} /> : isDayPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {safeFixed(kpis.dayVariationPercent)}%
                    </span>
                </div>
            </div>

            {/* 2. VALOR APLICADO */}
            <StatCard
                label="Valor Aplicado"
                tooltipText="Custo Contábil: Soma exata do dinheiro que saiu do seu bolso. Não inclui dividendos reinvestidos (estes aumentam apenas a quantidade de cotas)."
                icon={<DollarSign size={16} />}
                iconClass="bg-slate-800 text-slate-300"
                value={formatCurrency(kpis.totalInvested)}
                subLabel="Patrimônio + Proventos"
                subValue={formatCurrency(totalGross)}
                tag={<><Activity size={11} /> {grossMultiple.toFixed(2)}x</>}
                tagClass="bg-purple-500/10 text-purple-400 border-purple-500/20"
            />

            {/* 3. LUCRO TOTAL */}
            <StatCard
                label="Lucro Total"
                tooltipText="Resultado total = ganho de capital (valorização dos ativos) + proventos recebidos. O card 'Prov. Acumulados' detalha apenas a parcela de proventos."
                icon={<TrendingUp size={16} />}
                iconClass={isTotalPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}
                value={`${isTotalPositive ? '+' : ''}${formatCurrency(kpis.totalResult)}`}
                valueClass={isTotalPositive ? 'text-emerald-400' : 'text-red-400'}
                subLabel="Rentabilidade Real (TWRR)"
                subValue={
                    <span className={`inline-flex items-center gap-1 ${isRentabilityPositive ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {isRentabilityPositive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                        {safeFixed(kpis.weightedRentability)}%
                    </span>
                }
                tag={
                    <>
                        {kpis.sharpeRatio !== undefined && kpis.sharpeRatio !== 0 && (
                            <span className="inline-flex items-center gap-1 mr-1 text-slate-400" title="Índice de Sharpe (Retorno vs Risco)">
                                <Scale size={10} /> {kpis.sharpeRatio.toFixed(1)}
                            </span>
                        )}
                        {isAudited ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
                        {isAudited ? 'Auditado' : 'Estimado'}
                    </>
                }
                tagClass={isAudited ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'}
            />

            {/* 4. PROVENTOS */}
            <StatCard
                label="Prov. Acumulados"
                icon={<PiggyBank size={16} />}
                iconClass="bg-gold/10 text-gold"
                value={formatCurrency(kpis.totalDividends)}
                subLabel="Média Mensal Est."
                subValue={<span className="text-gold">{formatCurrency(kpis.projectedDividends)}</span>}
                tag={<><Layers size={11} /> Passivo</>}
                tagClass="bg-gold/10 text-gold border-gold/20"
            />

        </section>
    );
};

// Card de indicador padrão: superfície + ícone tingido em quadrado + pílula de tag,
// espelhando o layout do mock. Mantém os tokens de tema (bg-base/slate) p/ coerência
// com o resto do app (dark #080C14 / light branco).
const StatCard = ({ label, tooltipText, icon, iconClass, value, valueClass, subLabel, subValue, tag, tagClass }: any) => (
    <div className="bg-base border border-slate-800 rounded-2xl p-[18px] flex flex-col justify-between transition-colors hover:border-slate-700">
        <div className="flex justify-between items-start">
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
                {tooltipText && (
                    <div className="group/info relative flex items-center">
                        <Info size={11} className="text-slate-600 cursor-help hover:text-blue-400 transition-colors" />
                        <div className="absolute left-0 top-6 w-48 p-3 bg-elevated border border-slate-700 rounded-xl shadow-xl z-50 opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none">
                            <p className="text-[10px] text-slate-300 leading-relaxed font-medium">{tooltipText}</p>
                            <div className="absolute -top-1.5 left-2 w-3 h-3 bg-elevated border-t border-l border-slate-700 transform rotate-45"></div>
                        </div>
                    </div>
                )}
            </div>
            <span className={`w-[30px] h-[30px] rounded-[9px] flex items-center justify-center ${iconClass}`}>
                {icon}
            </span>
        </div>

        <FitText className={`font-extrabold tracking-tight mt-3.5 mb-4 ${valueClass || 'text-white'}`} max={26} min={14}>
            {value}
        </FitText>

        <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
            <div className="min-w-0">
                <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-0.5">{subLabel}</p>
                <div className="text-sm font-bold text-slate-200 truncate">{subValue}</div>
            </div>
            <span className={`shrink-0 ml-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${tagClass}`}>
                {tag}
            </span>
        </div>
    </div>
);
