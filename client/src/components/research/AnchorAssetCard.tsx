import { TrendingDown, TrendingUp } from 'lucide-react';

import type { AnchorRankingItem } from '../../services/research';
import type { AnchorStatus } from '../../utils/anchorStatus';
import { sectorLabelFor, type SectorGranularity } from '../../utils/sectorAllocation';
import { anchorStatusIcon, anchorTone } from './anchorStatusTheme';

/**
 * Cartão de um ativo da lista âncora — a página /buy-and-hold.
 *
 * Ficha de julgamento, não linha de tabela: score dominante, o freio de preço
 * que o motor usou de fato, os três eixos medidos e o veredicto escrito. O selo
 * do rodapé é INDICADOR — a página publica uma apuração, não uma ordem; nada
 * aqui é clicável, para não sugerir execução.
 */

const decimal = (value: number, digits = 1) => new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
}).format(value);

const brl = (value: number | null | undefined) => (
    value === null || value === undefined || !Number.isFinite(value)
        ? '—'
        : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
);

/** Barra de um eixo (0–100). Os três juntos são a leitura rápida da tese. */
const AxisBar = ({ label, value, bar }: { label: string; value?: number; bar: string }) => {
    const measured = Number.isFinite(value);
    const safe = measured ? Math.max(0, Math.min(100, value as number)) : 0;
    return (
        <div className="flex items-center gap-2.5">
            <span className="text-[9.5px] uppercase tracking-[0.08em] text-slate-500 w-[68px] shrink-0">{label}</span>
            <div className="flex-1 h-[5px] rounded-full bg-slate-700/50 overflow-hidden">
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${safe}%` }} />
            </div>
            <span className="text-[11px] font-bold text-slate-300 w-6 text-right tabular-nums">
                {measured ? Math.round(value as number) : '—'}
            </span>
        </div>
    );
};

/**
 * Régua de preço contra o valor justo. Só aparece para quem tem `premiumPct` —
 * ou seja, para as AÇÕES, cujo freio de entrada é literalmente esse prêmio.
 * O freio de um FII é o spread sobre a NTN-B ou o P/FFO, e desenhar a mesma
 * régua lá produziria a contradição de um fundo marcado com desconto sentado em
 * AGUARDANDO PREÇO.
 *
 * Escala: o centro é o valor justo e cada metade cobre 40 p.p. de prêmio ou
 * desconto — além disso o marcador encosta na borda, que é a leitura correta
 * (muito fora da faixa) sem precisar de eixo numérico.
 */
const PriceRail = ({ premiumPct, price, fair }: { premiumPct: number; price: number; fair: number }) => {
    const expensive = premiumPct > 0;
    const mark = Math.max(2, Math.min(98, 50 + Math.max(-40, Math.min(40, premiumPct)) * 1.2));
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[9.5px] uppercase tracking-[0.1em] text-slate-500 font-bold">Preço x valor justo</span>
                <span className={`inline-flex items-center gap-1 text-[11.5px] font-bold tabular-nums ${expensive ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {expensive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {expensive ? 'Prêmio' : 'Desconto'} {decimal(Math.abs(premiumPct))}%
                </span>
            </div>
            <div className="relative h-2 rounded-full bg-slate-700/40 overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-1/2 bg-emerald-500/15" />
                <div className="absolute inset-y-0 right-0 w-1/2 bg-yellow-500/15" />
                <div className="absolute inset-y-0 left-1/2 w-px bg-slate-400/60" />
                <div
                    className="absolute -inset-y-0.5 w-[3px] rounded-full bg-slate-100"
                    style={{ left: `calc(${mark}% - 1.5px)` }}
                />
            </div>
            <div className="flex items-baseline justify-between text-[11px] tabular-nums">
                <span className="text-slate-300 font-semibold">
                    {brl(price)} <span className="text-slate-500 font-normal">agora</span>
                </span>
                <span className="text-slate-500">justo {brl(fair)}</span>
            </div>
        </div>
    );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[9.5px] uppercase tracking-[0.08em] text-slate-500 truncate">{label}</span>
        <span className="text-[12px] font-bold text-slate-300 tabular-nums truncate">{value}</span>
    </div>
);

/** Leitura de entrada de um FII: os números que o motor de renda realmente freia. */
const IncomeMetrics = ({ item }: { item: AnchorRankingItem }) => {
    const anchor = item.anchor;
    return (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Metric label="Preço" value={brl(item.currentPrice)} />
            <Metric label="Justo" value={brl(item.targetPrice)} />
            {Number.isFinite(anchor?.spreadPp as number) && (
                <Metric label="Spread NTN-B" value={`${decimal(anchor?.spreadPp as number, 2)} p.p.`} />
            )}
            {Number.isFinite(anchor?.pFfo as number) && (
                <Metric label="P/FFO" value={`${decimal(anchor?.pFfo as number)}x`} />
            )}
            {Number.isFinite(anchor?.ffoCoverage as number) && (
                <Metric label="Cobertura FFO" value={`${decimal(anchor?.ffoCoverage as number, 2)}x`} />
            )}
            {anchor?.manager && <Metric label="Gestora" value={anchor.manager} />}
        </div>
    );
};

/** Selo de histerese: diz se o ativo entrou agora ou segue pela banda de permanência. */
const HysteresisTag = ({ item }: { item: AnchorRankingItem }) => {
    const state = item.anchor?.hysteresis?.state;
    if (state === 'HELD') {
        return (
            <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/25 whitespace-nowrap"
                title="Segue na lista pela banda de permanência: entra no limiar de entrada, só sai abaixo do de permanência."
            >
                mantida
            </span>
        );
    }
    if (state === 'ENTERED') {
        return (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 whitespace-nowrap">
                entrou agora
            </span>
        );
    }
    return null;
};

interface AnchorAssetCardProps {
    item: AnchorRankingItem;
    status: AnchorStatus;
    /** Granularidade do rótulo de setor — a MESMA do donut da seção. */
    sectorKind: SectorGranularity;
}

export const AnchorAssetCard = ({ item, status, sectorKind }: AnchorAssetCardProps) => {
    const tone = anchorTone(status.tone);
    const Icon = anchorStatusIcon(status.id);
    const axes = item.anchor?.axes;
    // Selo canonizado pela mesma régua do gráfico: o cartão dizer "Elétricas" e a
    // fatia dizer outra coisa é o que faz o assinante desconfiar do rótulo.
    const sector = item.sector ? sectorLabelFor({ sector: item.sector }, sectorKind) : '';

    const premiumPct = item.anchor?.premiumPct;
    const hasRail = Number.isFinite(premiumPct as number)
        && Number.isFinite(item.currentPrice)
        && Number.isFinite(item.targetPrice);

    return (
        <article className={`flex flex-col rounded-2xl border bg-card overflow-hidden ${tone.border}`}>
            <div className={`px-4 pt-4 pb-3 bg-gradient-to-b ${tone.wash} to-transparent`}>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-black text-slate-100 leading-none">{item.ticker}</h3>
                            <HysteresisTag item={item} />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 line-clamp-2 leading-snug">{item.name || sector}</p>
                    </div>
                    <div className="text-right shrink-0">
                        <div className={`text-[26px] font-black leading-none tabular-nums ${tone.score}`}>{item.score}</div>
                        <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500 mt-1">score</div>
                    </div>
                </div>
                {sector && (
                    <span className="inline-block mt-3 text-[9px] uppercase tracking-[0.1em] text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">
                        {sector}
                    </span>
                )}
            </div>

            <div className="px-4 pb-3.5">
                {hasRail
                    ? <PriceRail premiumPct={premiumPct as number} price={item.currentPrice} fair={item.targetPrice} />
                    : <IncomeMetrics item={item} />}
            </div>

            <div className="px-4 py-3.5 border-t border-slate-800 space-y-2">
                <AxisBar label="Durabilidade" value={axes?.durability} bar={tone.bar} />
                <AxisBar label="Resiliência" value={axes?.resilience} bar={tone.bar} />
                <AxisBar label="Consistência" value={axes?.consistency} bar={tone.bar} />
            </div>

            {/* O motivo em texto é o produto tanto quanto o score: uma lista âncora
                que não explica por que um ativo está fora do COMPRAR obriga o
                assinante a adivinhar se é o negócio, o preço ou a carteira. */}
            <div className="px-4 py-3.5 border-t border-slate-800 flex flex-col gap-3 mt-auto">
                <p className="text-[11.5px] text-slate-400 leading-relaxed">{item.reason}</p>
                <div
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[10.5px] font-black tracking-[0.06em] ${tone.pill}`}
                    title={status.description}
                >
                    <Icon size={13} /> {status.label}
                </div>
            </div>
        </article>
    );
};
