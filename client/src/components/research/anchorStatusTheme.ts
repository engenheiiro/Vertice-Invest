import { AlertTriangle, Clock, Eye, Layers, ShieldCheck } from 'lucide-react';

import type { AnchorStatusId, AnchorStatusTone } from '../../utils/anchorStatus';

/**
 * Pele visual dos status da lista âncora — separada de `utils/anchorStatus.ts`,
 * que decide o status e não deve conhecer Tailwind nem ícone.
 *
 * As classes são LITERAIS de propósito: o scanner do Tailwind lê o código-fonte
 * e não enxerga `text-${tone}-400` montado em tempo de execução.
 */

export interface AnchorTone {
    /** Borda do cartão. */
    border: string;
    /** Lavagem de cor no topo do cartão (gradiente para transparente). */
    wash: string;
    /** Score e título de seção. */
    score: string;
    /** Preenchimento das barras de eixo. */
    bar: string;
    /** Selo indicador do rodapé. */
    pill: string;
    /** Régua vertical do cabeçalho de seção. */
    rule: string;
}

const TONE: Record<AnchorStatusTone, AnchorTone> = {
    emerald: {
        border: 'border-emerald-500/25',
        wash: 'from-emerald-500/[0.07]',
        score: 'text-emerald-400',
        bar: 'bg-emerald-500/70',
        pill: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        rule: 'bg-emerald-400',
    },
    yellow: {
        border: 'border-yellow-500/25',
        wash: 'from-yellow-500/[0.06]',
        score: 'text-yellow-400',
        bar: 'bg-yellow-500/70',
        pill: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
        rule: 'bg-yellow-400',
    },
    blue: {
        border: 'border-blue-500/25',
        wash: 'from-blue-500/[0.06]',
        score: 'text-blue-400',
        bar: 'bg-blue-500/70',
        pill: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
        rule: 'bg-blue-400',
    },
    orange: {
        border: 'border-orange-500/25',
        wash: 'from-orange-500/[0.06]',
        score: 'text-orange-400',
        bar: 'bg-orange-500/70',
        pill: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
        rule: 'bg-orange-400',
    },
    slate: {
        border: 'border-slate-800',
        wash: 'from-slate-500/[0.05]',
        score: 'text-slate-300',
        bar: 'bg-slate-500/70',
        pill: 'bg-slate-700/40 text-slate-300 border-slate-700',
        rule: 'bg-slate-500',
    },
};

const STATUS_ICON: Record<AnchorStatusId, typeof ShieldCheck> = {
    BUY: ShieldCheck,
    PRICE: Clock,
    COMPOSITION: Layers,
    INCOME: AlertTriangle,
    CONVICTION: Eye,
};

export const anchorTone = (tone: AnchorStatusTone): AnchorTone => TONE[tone];
export const anchorStatusIcon = (id: AnchorStatusId) => STATUS_ICON[id];
