
import React from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { Wallet, TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, ArrowRight, Activity, Layers, Info, ShieldCheck, AlertTriangle, Scale, Minus } from 'lucide-react';
import { SkeletonKpiGrid, FitText } from '../ui';
import { formatCurrency as fmtCurrency, formatSharpe, describeSharpe } from '../../utils/format';
import { useCountUp } from '../../hooks/useCountUp';
import { DayMoversModal } from '../wallet/DayMoversModal';

interface EquitySummaryProps {
    onGenerateReport?: () => void;
}

/**
 * KPIs patrimoniais do Terminal. Compartilha a MESMA linguagem visual do
 * `WalletSummary` da aba Carteira (card-herói verde + StatCard com ícone em
 * quadrado tingido + pílulas arredondadas), variando apenas o grid (aqui a
 * coluna é mais estreita: 2 col no md, 4 no xl). Valores usam <FitText> para
 * nunca cortar dígitos em patrimônios grandes.
 */
export const EquitySummary: React.FC<EquitySummaryProps> = () => {
    const { kpis, isPrivacyMode, isLoading, isReadOnly } = useWallet();
    const animatedEquity = useCountUp(kpis?.totalEquity || 0);
    // Hooks primeiro: o guard de `isLoading` abaixo retorna cedo.
    const [isDayModalOpen, setIsDayModalOpen] = React.useState(false);

    const formatCurrency = (val: number | null | undefined) => fmtCurrency(val, 'BRL', { privacy: isPrivacyMode });

    const safeFixed = (val: number | null | undefined) => {
        if (isPrivacyMode) return '•••';
        return (val || 0).toFixed(2);
    };

    const isDayPositive = (kpis?.dayVariation || 0) >= 0;
    const isDayFlat = (kpis?.dayVariation || 0) === 0;
    const isTotalPositive = (kpis?.totalResult || 0) >= 0;
    const isRentabilityPositive = (kpis?.weightedRentability || 0) >= 0;

    // Badge do Patrimônio = variação do CAPITAL (patrimônio vs. aplicado), não o
    // retorno total (esse, com proventos, vive no card Lucro Total).
    const capitalVariationPercent = (kpis?.totalInvested || 0) > 0
        ? (((kpis?.totalEquity || 0) - (kpis?.totalInvested || 0)) / kpis.totalInvested) * 100
        : 0;
    const isCapitalPositive = capitalVariationPercent >= 0;
    const isAudited = kpis?.dataQuality === 'AUDITED';
    // null quando o servidor não teve amostra para medir risco — o badge some.
    const sharpeLabel = formatSharpe(kpis?.sharpeRatio, { confidence: kpis?.sharpeConfidence });
    const sharpeTitle = describeSharpe({
        standardError: kpis?.sharpeStandardError,
        confidence: kpis?.sharpeConfidence,
        sample: kpis?.sharpeSample,
    });

    const totalGross = (kpis?.totalEquity || 0) + (kpis?.totalDividends || 0);
    const grossMultiple = (kpis?.totalInvested || 0) > 0 ? totalGross / kpis.totalInvested : 0;

    if (isLoading) {
        return <SkeletonKpiGrid count={4} />;
    }

    return (
        // No celular, cada KPI ocupa a largura inteira — o mesmo comportamento da Carteira.
        <section aria-label="Resumo patrimonial" className="grid auto-rows-fr grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">

            {/* 1. PATRIMÔNIO LÍQUIDO — card "herói" em gradiente verde (destaque). */}
            {/* Verde-escuro nos dois temas → texto sempre branco (valores arbitrários
                porque o tema claro sobrescreveria .text-white p/ tons escuros). */}
            <div
                className="relative h-full overflow-hidden rounded-2xl p-[18px] text-[#fff]"
                style={{
                    background: 'linear-gradient(180deg, #0f5f47, #0c4f3b)',
                    boxShadow: '0 14px 30px -18px rgba(12,79,59,.9)',
                }}
            >
                <div
                    className="absolute right-[-30px] top-[-30px] w-[130px] h-[130px] rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(255,255,255,.14), transparent 70%)' }}
                />
                <div className="relative flex min-h-[22px] items-start pr-10">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[rgba(255,255,255,0.72)]">Patrimônio Líquido</span>
                    <span className="absolute right-0 top-0 w-[30px] h-[30px] rounded-[9px] bg-white/[0.14] flex items-center justify-center text-[#eafff6]">
                        <Wallet size={16} />
                    </span>
                </div>

                <div className="relative flex items-baseline gap-2 mt-1">
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

                {/* items-end: com o "Ver o dia" abaixo do valor, a pílula acompanha
                    a base da coluna, não o centro. */}
                <div className="relative flex items-end justify-between mt-3 pt-3 border-t border-white/[0.14]">
                    <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-[rgba(255,255,255,0.6)] mb-0.5">Variação Hoje</p>
                        <div className="text-sm font-bold text-[#fff] truncate">
                            {isDayPositive ? '+' : ''}{formatCurrency(kpis.dayVariation)}
                        </div>
                        {/* Mesmo detalhamento da Carteira: os dois cards leem o mesmo
                            contexto, então um componente só atende os dois. */}
                        {!isReadOnly && (
                            <button
                                type="button"
                                onClick={() => setIsDayModalOpen(true)}
                                className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-white/[0.26] bg-white/[0.09] px-2.5 py-1 text-[11px] font-semibold text-[#eafff6] transition-colors hover:border-white/40 hover:bg-white/[0.17] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8ff0c8]"
                            >
                                Ver o dia
                                <ArrowRight size={11} />
                            </button>
                        )}
                    </div>
                    <span className="shrink-0 ml-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-[#eafff6] bg-white/[0.14] px-2.5 py-1 rounded-full">
                        {isDayFlat ? <Minus size={12} /> : isDayPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {safeFixed(kpis.dayVariationPercent)}%
                    </span>
                </div>
            </div>

            {/* 2. VALOR APLICADO */}
            <StatCard
                label="Valor Aplicado"
                tooltipText="Custo Contábil: soma exata do dinheiro que saiu do seu bolso. Não inclui dividendos reinvestidos (estes aumentam apenas a quantidade de cotas)."
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
                        {sharpeLabel && (
                            <span className="inline-flex items-center gap-1 mr-1 text-slate-400" title={sharpeTitle}>
                                <Scale size={10} /> {sharpeLabel}
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
                tooltipText="Tudo que seus ativos já anunciaram, incluindo o que ainda vai cair na conta (detalhe na aba Proventos). A Média Mensal Est. é quanto isso rende por mês."
                icon={<PiggyBank size={16} />}
                iconClass="bg-gold/10 text-gold"
                value={formatCurrency(kpis.totalDividends)}
                subLabel="Média Mensal Est."
                subValue={<span className="text-gold">{formatCurrency(kpis.projectedDividends)}</span>}
                tag={<><Layers size={11} /> Passivo</>}
                tagClass="bg-gold/10 text-gold border-gold/20"
            />

            <DayMoversModal isOpen={isDayModalOpen} onClose={() => setIsDayModalOpen(false)} />
        </section>
    );
};

// Card de indicador padrão: superfície + ícone tingido em quadrado + pílula de tag.
// Espelha o StatCard da aba Carteira; o valor usa <FitText> p/ nunca cortar dígitos.
const StatCard = ({ label, tooltipText, icon, iconClass, value, valueClass, subLabel, subValue, tag, tagClass, className = '' }: any) => (
    <div className={`h-full bg-base border border-slate-800 rounded-2xl p-[18px] flex flex-col transition-colors hover:border-slate-700 ${className}`}>
        <div className="relative flex min-h-[22px] items-start pr-10">
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
            <span className={`absolute right-0 top-0 w-[30px] h-[30px] rounded-[9px] flex items-center justify-center ${iconClass}`}>
                {icon}
            </span>
        </div>

        <FitText className={`font-extrabold tracking-tight mt-1 mb-3 ${valueClass || 'text-white'}`} max={26} min={14}>
            {value}
        </FitText>

        {/* Valor secundário e selo compartilham a mesma linha — ver WalletSummary. */}
        <div className="mt-auto pt-3 border-t border-slate-800/80">
            <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1">{subLabel}</p>
            <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0 text-sm font-bold text-slate-200 truncate">{subValue}</div>
                <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${tagClass}`}>
                    {tag}
                </span>
            </div>
        </div>
    </div>
);
