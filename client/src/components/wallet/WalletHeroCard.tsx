import React from 'react';
import { Wallet, ArrowUpRight, ArrowDownRight, ChevronRight, Minus } from 'lucide-react';
import { FitText, PrivacyToggle } from '../ui';
import { plusSign, type EquitySummaryView } from '../dashboard/equitySummaryView';
import { InfoTooltip } from './WalletStatCard';

interface WalletHeroCardProps {
    view: EquitySummaryView;
    /** Patrimônio já animado (count-up) e formatado. */
    equityText: string;
    /** Variação do dia já formatada (sem sinal). */
    dayVariationText: string;
    dayPercentText: string;
    capitalPercentText: string;
    isPrivacyMode: boolean;
    onTogglePrivacy: () => void;
    isValuesLocked: boolean;
    isReadOnly: boolean;
    onOpenDay: () => void;
}

const DAY_LABEL = 'Ver de quais ativos veio a variação de hoje';

/**
 * O próprio valor abre o detalhamento — a setinha é a única marca de que há
 * algo atrás. O `-m-1 p-1` dá área de clique sem deslocar o texto nem crescer a
 * altura do card. No link público não há botão: o detalhamento não é oferecido
 * ao visitante.
 */
const DayVariationValue = ({ text, isReadOnly, onOpenDay }: { text: string; isReadOnly: boolean; onOpenDay: () => void }) => {
    if (isReadOnly) return <div className="text-sm font-bold text-[#fff]">{text}</div>;
    return (
        <button
            type="button"
            onClick={onOpenDay}
            title={DAY_LABEL}
            aria-label={DAY_LABEL}
            className="group -m-1 flex items-center gap-1 rounded-md p-1 text-sm font-bold text-[#fff] transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8ff0c8]"
        >
            {text}
            <ChevronRight size={13} className="text-[rgba(255,255,255,0.55)] transition-colors group-hover:text-[#eafff6]" />
        </button>
    );
};

const DayDirectionIcon = ({ isFlat, isPositive }: { isFlat: boolean; isPositive: boolean }) => {
    if (isFlat) return <Minus size={12} />;
    return isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />;
};

/**
 * Card "herói" do Patrimônio Líquido, em gradiente verde. Verde-escuro nos DOIS
 * temas → texto sempre branco. Valores arbitrários (text-[#fff], rgba…) porque
 * o tema claro sobrescreve .text-white e .text-white/xx para tons escuros — o
 * que apagaria o texto sobre o verde.
 */
export const WalletHeroCard = ({
    view, equityText, dayVariationText, dayPercentText, capitalPercentText,
    isPrivacyMode, onTogglePrivacy, isValuesLocked, isReadOnly, onOpenDay,
}: WalletHeroCardProps) => (
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
                        onToggle={onTogglePrivacy}
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
                {equityText}
            </FitText>
            <span
                className={`shrink-0 text-xs font-bold ${view.capitalClass}`}
                title="Variação do capital: patrimônio atual vs. valor investido (sem proventos)."
            >
                {plusSign(view.isCapitalPositive)}{capitalPercentText}%
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
                <DayVariationValue
                    text={`${plusSign(view.isDayPositive)}${dayVariationText}`}
                    isReadOnly={isReadOnly}
                    onOpenDay={onOpenDay}
                />
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#eafff6] bg-white/[0.14] px-2.5 py-1 rounded-full">
                <DayDirectionIcon isFlat={view.isDayFlat} isPositive={view.isDayPositive} />
                {dayPercentText}%
            </span>
        </div>
    </div>
);
