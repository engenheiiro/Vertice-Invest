import React from 'react';
import { Wallet, ArrowUpRight, ArrowDownRight, ChevronRight, Minus } from 'lucide-react';
import { FitText } from '../ui';
import { HERO_STYLE, plusSign, type EquitySummaryView } from './equitySummaryView';

interface EquityHeroCardProps {
    view: EquitySummaryView;
    /** Patrimônio já animado (count-up) e formatado. */
    equityText: string;
    /** Variação do dia já formatada (sem sinal). */
    dayVariationText: string;
    dayPercentText: string;
    capitalPercentText: string;
    isReadOnly: boolean;
    onOpenDay: () => void;
}

const DAY_LABEL = 'Ver de quais ativos veio a variação de hoje';

/** Mesmo detalhamento da Carteira, mesma entrada: o valor abre, a setinha sinaliza. Ver WalletSummary. */
const DayVariationValue = ({ text, isReadOnly, onOpenDay }: { text: string; isReadOnly: boolean; onOpenDay: () => void }) => {
    if (isReadOnly) {
        return <div className="text-sm font-bold text-[#fff] truncate">{text}</div>;
    }
    return (
        <button
            type="button"
            onClick={onOpenDay}
            title={DAY_LABEL}
            aria-label={DAY_LABEL}
            className="group -m-1 flex min-w-0 items-center gap-1 rounded-md p-1 text-sm font-bold text-[#fff] transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8ff0c8]"
        >
            <span className="truncate">{text}</span>
            <ChevronRight size={13} className="shrink-0 text-[rgba(255,255,255,0.55)] transition-colors group-hover:text-[#eafff6]" />
        </button>
    );
};

export const DayDirectionIcon = ({ isFlat, isPositive }: { isFlat: boolean; isPositive: boolean }) => {
    if (isFlat) return <Minus size={12} />;
    return isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />;
};

export const HeroWalletIcon = () => (
    <span className="absolute right-0 top-0 w-[30px] h-[30px] rounded-[9px] bg-white/[0.14] flex items-center justify-center text-[#eafff6]">
        <Wallet size={16} />
    </span>
);

/** Badge = variação do CAPITAL, não o retorno total (esse, com proventos, vive no card Lucro Total). */
const CapitalBadge = ({ view, text }: { view: EquitySummaryView; text: string }) => (
    <span
        className={`shrink-0 text-xs font-bold ${view.capitalClass}`}
        title="Variação do capital: patrimônio atual vs. valor investido (sem proventos)."
    >
        {plusSign(view.isCapitalPositive)}{text}%
    </span>
);

/** Patrimônio (ajusta a fonte para caber) + badge do capital. */
export const HeroEquityRow = ({ view, equityText, capitalPercentText }: { view: EquitySummaryView; equityText: string; capitalPercentText: string }) => (
    <div className="relative flex items-baseline gap-2 mt-1">
        <FitText className="flex-1 font-extrabold tracking-tight" max={28} min={15} aria-live="polite" aria-atomic={true}>
            {equityText}
        </FitText>
        <CapitalBadge view={view} text={capitalPercentText} />
    </div>
);

/**
 * Card "herói" do Patrimônio Líquido, em gradiente verde. Verde-escuro nos dois
 * temas → texto sempre branco (valores arbitrários porque o tema claro
 * sobrescreveria .text-white p/ tons escuros).
 */
export const EquityHeroCard = ({
    view, equityText, dayVariationText, dayPercentText, capitalPercentText, isReadOnly, onOpenDay,
}: EquityHeroCardProps) => (
    <div
        className="relative h-full overflow-hidden rounded-2xl p-[18px] text-[#fff]"
        style={HERO_STYLE}
    >
        <div
            className="absolute right-[-30px] top-[-30px] w-[130px] h-[130px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,.14), transparent 70%)' }}
        />
        <div className="relative flex min-h-[22px] items-start pr-10">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[rgba(255,255,255,0.72)]">Patrimônio Líquido</span>
            <HeroWalletIcon />
        </div>

        <HeroEquityRow view={view} equityText={equityText} capitalPercentText={capitalPercentText} />

        <div className="relative flex items-center justify-between mt-3 pt-3 border-t border-white/[0.14]">
            <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[rgba(255,255,255,0.6)] mb-0.5">Variação Hoje</p>
                <DayVariationValue
                    text={`${plusSign(view.isDayPositive)}${dayVariationText}`}
                    isReadOnly={isReadOnly}
                    onOpenDay={onOpenDay}
                />
            </div>
            <span className="shrink-0 ml-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-[#eafff6] bg-white/[0.14] px-2.5 py-1 rounded-full">
                <DayDirectionIcon isFlat={view.isDayFlat} isPositive={view.isDayPositive} />
                {dayPercentText}%
            </span>
        </div>
    </div>
);
