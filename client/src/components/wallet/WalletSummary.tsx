
import React from 'react';
import { createPortal } from 'react-dom';
import { useWallet } from '../../contexts/WalletContext';
import { Wallet, TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, ChevronRight, Activity, Layers, Info, ShieldCheck, AlertTriangle, Scale, Minus } from 'lucide-react';
import { SkeletonKpiGrid, FitText, PrivacyToggle } from '../ui'; // (I12) skeleton padronizado + auto-fit de valor
import { formatCurrency as fmtCurrency, formatSharpe, describeSharpe } from '../../utils/format';
import { useCountUp } from '../../hooks/useCountUp';
import { totalResultBalance } from '../../utils/kpiCalculations';
import { DayMoversModal } from './DayMoversModal';

interface EquitySummaryProps {
    onGenerateReport?: () => void;
}

export const WalletSummary: React.FC<EquitySummaryProps> = () => {
    const { kpis, isPrivacyMode, togglePrivacyMode, isLoading, isValuesLocked, isReadOnly } = useWallet();
    const animatedEquity = useCountUp(kpis?.totalEquity || 0);
    // Hooks primeiro: o guard de `isLoading` abaixo retorna cedo, e declarar
    // estado depois dele quebraria a ordem entre renderizações.
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

    // Badge do Patrimônio Líquido = variação do CAPITAL (patrimônio vs. investido),
    // não o retorno total. O retorno total (com proventos) fica no card Lucro Total.
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

    // Uma só identidade para card e gráfico: Aplicado + Resultado Total.
    // Não recompomos por patrimônio + proventos, pois a soma das posições pode
    // conservar subcentavos enquanto os KPIs do servidor já vêm arredondados.
    const totalGross = totalResultBalance(kpis);
    const grossMultiple = (kpis?.totalInvested || 0) > 0 ? totalGross / kpis.totalInvested : 0;

    if (isLoading) {
        return <SkeletonKpiGrid count={4} className="mb-8" />;
    }

    return (
        // (A7) região nomeada para os indicadores patrimoniais (landmark)
        // No celular, cada KPI ocupa a largura inteira para preservar a leitura dos
        // valores. A partir do tablet, o resumo volta ao grid compacto.
        <section aria-label="Resumo patrimonial" className="grid auto-rows-fr grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">

            {/* 1. PATRIMÔNIO LÍQUIDO — card "herói" em gradiente verde (destaque da carteira) */}
            {/* Card sempre verde-escuro nos DOIS temas → texto sempre branco. Usamos valores
                arbitrários (text-[#fff], rgba…) porque o tema claro sobrescreve .text-white
                e .text-white/xx para tons escuros — o que apagaria o texto sobre o verde. */}
            <div
                className="relative h-full rounded-2xl p-[18px] text-[#fff]"
                style={{
                    background: 'linear-gradient(180deg, #0f5f47, #0c4f3b)',
                    boxShadow: '0 14px 30px -18px rgba(12,79,59,.9)',
                }}
            >
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                    <div
                        className="absolute right-[-30px] top-[-30px] h-[130px] w-[130px] rounded-full"
                        style={{ background: 'radial-gradient(circle, rgba(255,255,255,.14), transparent 70%)' }}
                    />
                </div>
                <div className="relative flex min-h-[22px] items-start pr-10">
                    <div className="relative flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[rgba(255,255,255,0.72)]">Patrimônio Líquido</span>
                        {/* No link público sem valores liberados não há número real
                            para revelar — o botão sairia mentindo que revela. */}
                        {!isValuesLocked && (
                            <PrivacyToggle
                                isPrivacyMode={isPrivacyMode}
                                onToggle={togglePrivacyMode}
                                size={14}
                                className="absolute left-full top-1/2 ml-1 min-h-[36px] min-w-[36px] -translate-y-1/2 inline-flex items-center justify-center hover:bg-white/[0.14] rounded-lg text-[rgba(255,255,255,0.6)] hover:text-[rgba(255,255,255,0.9)] transition-colors"
                            />
                        )}
                    </div>
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

                <div className="relative flex items-center justify-between mt-3 pt-3 border-t border-white/[0.14]">
                    <div>
                        <div className="mb-0.5 flex items-center gap-1">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-[rgba(255,255,255,0.6)]">Variação Hoje</p>
                            <InfoTooltip
                                text="Ganho ou perda desde o fechamento anterior."
                                iconClass="text-[rgba(255,255,255,0.55)] hover:text-[#eafff6]"
                            />
                        </div>
                        {/* O próprio valor abre o detalhamento — a setinha é a única
                            marca de que há algo atrás. O `-m-1 p-1` dá área de clique
                            sem deslocar o texto nem crescer a altura do card. No link
                            público não há botão: o detalhamento não é oferecido ao
                            visitante. */}
                        {isReadOnly ? (
                            <div className="text-sm font-bold text-[#fff]">
                                {isDayPositive ? '+' : ''}{formatCurrency(kpis.dayVariation)}
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setIsDayModalOpen(true)}
                                title="Ver de quais ativos veio a variação de hoje"
                                aria-label="Ver de quais ativos veio a variação de hoje"
                                className="group -m-1 flex items-center gap-1 rounded-md p-1 text-sm font-bold text-[#fff] transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8ff0c8]"
                            >
                                {isDayPositive ? '+' : ''}{formatCurrency(kpis.dayVariation)}
                                <ChevronRight size={13} className="text-[rgba(255,255,255,0.55)] transition-colors group-hover:text-[#eafff6]" />
                            </button>
                        )}
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
                tooltipText="Total que saiu do seu bolso."
                icon={<DollarSign size={16} />}
                iconClass="bg-slate-800 text-slate-300"
                value={formatCurrency(kpis.totalInvested)}
                subLabel="Aplicado + Resultado"
                subValue={formatCurrency(totalGross)}
                tag={<><Activity size={11} /> {grossMultiple.toFixed(2)}x</>}
                tagClass="bg-purple-500/10 text-purple-400 border-purple-500/20"
            />

            {/* 3. LUCRO TOTAL */}
            <StatCard
                label="Lucro Total"
                tooltipText="Valorização + proventos recebidos."
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
                tooltipText="Proventos recebidos e a receber."
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

// Card de indicador padrão: superfície + ícone tingido em quadrado + pílula de tag,
// espelhando o layout do mock. Mantém os tokens de tema (bg-base/slate) p/ coerência
// com o resto do app (dark #080C14 / light branco).
const StatCard = ({ label, tooltipText, icon, iconClass, value, valueClass, subLabel, subValue, tag, tagClass, className = '' }: any) => (
    <div className={`h-full bg-base border border-slate-800 rounded-2xl p-[18px] flex flex-col transition-colors hover:border-slate-700 ${className}`}>
        <div className="relative flex min-h-[22px] items-start pr-10">
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
                {tooltipText && (
                    <InfoTooltip text={tooltipText} />
                )}
            </div>
            <span className={`absolute right-0 top-0 w-[30px] h-[30px] rounded-[9px] flex items-center justify-center ${iconClass}`}>
                {icon}
            </span>
        </div>

        <FitText className={`font-extrabold tracking-tight mt-1 mb-3 ${valueClass || 'text-white'}`} max={26} min={14}>
            {value}
        </FitText>

        {/* Valor secundário e selo compartilham a mesma linha para manter todos os KPIs compactos. */}
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

type TooltipPosition = {
    left: number;
    top: number;
    arrowLeft: number;
    placement: 'above' | 'below';
};

const InfoTooltip = ({ text, iconClass = 'text-slate-600 hover:text-blue-400' }: { text: string; iconClass?: string }) => {
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const [position, setPosition] = React.useState<TooltipPosition | null>(null);

    const showTooltip = () => {
        const trigger = triggerRef.current;
        if (!trigger) return;

        const triggerRect = trigger.getBoundingClientRect();
        const tooltipWidth = 192;
        const halfWidth = tooltipWidth / 2;
        const viewportPadding = 8;
        const triggerCenter = triggerRect.left + triggerRect.width / 2;
        const left = Math.min(
            window.innerWidth - halfWidth - viewportPadding,
            Math.max(halfWidth + viewportPadding, triggerCenter)
        );
        // O padrão visual é abaixo do ícone. Se faltar espaço no fim da janela,
        // inverte para cima; o portal impede recorte pelos limites do card.
        const placement = window.innerHeight - triggerRect.bottom >= 80 ? 'below' : 'above';
        const top = placement === 'below' ? triggerRect.bottom + 8 : triggerRect.top - 8;
        const arrowLeft = Math.min(tooltipWidth - 12, Math.max(12, triggerCenter - (left - halfWidth)));

        setPosition({ left, top, arrowLeft, placement });
    };

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                data-tooltip-trigger
                aria-label={text}
                onMouseEnter={showTooltip}
                onMouseLeave={() => setPosition(null)}
                onFocus={showTooltip}
                onBlur={() => setPosition(null)}
                className="relative flex items-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
                <Info size={11} className={`${iconClass} cursor-help transition-colors`} />
            </button>
            {position && createPortal(
                <span
                    role="tooltip"
                    style={{
                        left: position.left,
                        top: position.top,
                        transform: position.placement === 'above' ? 'translate(-50%, -100%)' : 'translateX(-50%)',
                    }}
                    className="pointer-events-none fixed z-[200] w-48 rounded-xl border border-slate-700 bg-elevated p-3 text-left text-[10px] font-medium leading-relaxed text-slate-300 shadow-xl"
                >
                    {text}
                    <span
                        aria-hidden="true"
                        style={{ left: position.arrowLeft }}
                        className={`absolute h-3 w-3 -translate-x-1/2 rotate-45 bg-elevated ${position.placement === 'above'
                            ? '-bottom-1.5 border-b border-r border-slate-700'
                            : '-top-1.5 border-l border-t border-slate-700'
                            }`}
                    />
                </span>,
                document.body
            )}
        </>
    );
};
