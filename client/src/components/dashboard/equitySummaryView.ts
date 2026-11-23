import type { WalletKPIs } from '../../contexts/WalletContext';
import { formatSharpe, describeSharpe } from '../../utils/format';

/**
 * Derivação pura do card de patrimônio do Terminal: tudo que o `EquitySummary`
 * decide a partir dos KPIs (sinais, cores, múltiplo, selo de risco), fora do
 * JSX. Não recalcula patrimônio nem custo — só lê o que o contexto entrega
 * (regra 8: o custo já vem congelado no câmbio de cada lançamento).
 */

/** Fundo verde do card herói — o mesmo na Carteira e no Terminal. */
export const HERO_STYLE = {
    background: 'linear-gradient(180deg, #0f5f47, #0c4f3b)',
    boxShadow: '0 14px 30px -18px rgba(12,79,59,.9)',
} as const;

/** Campo ausente, nulo ou NaN conta como zero — o mesmo `x || 0` de antes. */
const orZero = (val: number | null | undefined): number => val || 0;

/** Sinal textual: zero conta como positivo e ganha "+". */
export const plusSign = (positive: boolean): string => (positive ? '+' : '');

/** Percentual com 2 casas, mascarado no modo privacidade. */
export const fixedOrMask = (val: number | null | undefined, privacy: boolean): string =>
    (privacy ? '•••' : orZero(val).toFixed(2));

/** Variação do CAPITAL (patrimônio vs. aplicado), sem proventos; 0 sem aporte. */
const capitalVariation = (equity: number, invested: number): number =>
    (invested > 0 ? ((equity - invested) / invested) * 100 : 0);

const tone = (positive: boolean, up: string, down: string): string => (positive ? up : down);

export interface EquitySummaryView {
    isDayPositive: boolean;
    isDayFlat: boolean;
    capitalVariationPercent: number;
    isCapitalPositive: boolean;
    capitalClass: string;
    isTotalPositive: boolean;
    totalIconClass: string;
    totalValueClass: string;
    isRentabilityPositive: boolean;
    rentabilityClass: string;
    isAudited: boolean;
    qualityTagClass: string;
    /** `null` quando o servidor não teve amostra para medir risco — o badge some. */
    sharpeLabel: string | null;
    sharpeTitle: string;
    totalGross: number;
    grossMultiple: number;
}

export function buildEquitySummaryView(kpis: WalletKPIs): EquitySummaryView {
    const equity = orZero(kpis.totalEquity);
    const invested = orZero(kpis.totalInvested);
    const dayVariation = orZero(kpis.dayVariation);
    const capitalVariationPercent = capitalVariation(equity, invested);
    const isCapitalPositive = capitalVariationPercent >= 0;
    const isTotalPositive = orZero(kpis.totalResult) >= 0;
    const isRentabilityPositive = orZero(kpis.weightedRentability) >= 0;
    const isAudited = kpis.dataQuality === 'AUDITED';
    const totalGross = equity + orZero(kpis.totalDividends);

    return {
        isDayPositive: dayVariation >= 0,
        isDayFlat: dayVariation === 0,
        capitalVariationPercent,
        isCapitalPositive,
        capitalClass: tone(isCapitalPositive, 'text-[#8ff0c8]', 'text-[#fca5a5]'),
        isTotalPositive,
        totalIconClass: tone(isTotalPositive, 'bg-emerald-500/10 text-emerald-400', 'bg-red-500/10 text-red-400'),
        totalValueClass: tone(isTotalPositive, 'text-emerald-400', 'text-red-400'),
        isRentabilityPositive,
        rentabilityClass: tone(isRentabilityPositive, 'text-emerald-400', 'text-slate-400'),
        isAudited,
        qualityTagClass: tone(
            isAudited,
            'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
        ),
        sharpeLabel: formatSharpe(kpis.sharpeRatio, { confidence: kpis.sharpeConfidence }),
        sharpeTitle: describeSharpe({
            standardError: kpis.sharpeStandardError,
            confidence: kpis.sharpeConfidence,
            sample: kpis.sharpeSample,
        }),
        totalGross,
        grossMultiple: invested > 0 ? totalGross / invested : 0,
    };
}
