import React from 'react';
import { CircleDollarSign, Landmark, MoonStar } from 'lucide-react';
import { formatPercent } from '../../utils/format';
import { reasonDescription, type DayMovers } from '../../utils/dayMovers';
import {
    dayTone, formatShortDay, sinceAnchorText,
    type MoneyFormatters, type MoverGroup,
} from '../../utils/dayMoversView';
import { CompositionBar, GRID, MoverRow } from './DayMoverRow';

/** Recuo lateral: 28px no desktop, como no protótipo; 20px no celular. */
export const PAD = 'px-5 sm:px-7';

interface SummaryProps {
    movers: DayMovers;
    fmt: MoneyFormatters;
    equity: number | null;
    assetCount: number;
    unmeasuredCount: number;
}

/** Contagem de alta/queda/sem variação, ao lado da barra de composição. */
const CompositionLegend: React.FC<{ movers: DayMovers; unmeasuredCount: number }> = ({ movers, unmeasuredCount }) => (
    <div className="w-full sm:w-[210px]">
        <CompositionBar up={movers.upCount} down={movers.downCount} flat={unmeasuredCount} />
        <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-slate-400">
            <span><span className="font-mono font-bold text-emerald-400">{movers.upCount}</span> em alta</span>
            <span><span className="font-mono font-bold text-red-400">{movers.downCount}</span> em queda</span>
            {unmeasuredCount > 0 && (
                <span className="text-slate-500">
                    <span className="font-mono font-bold">{unmeasuredCount}</span> sem variação
                </span>
            )}
        </div>
    </div>
);

/** Cabeçalho: o total é o do card, repetido aqui para o usuário ver de onde a lista parte. */
export const DayMoversSummary: React.FC<SummaryProps> = ({ movers, fmt, equity, assetCount, unmeasuredCount }) => {
    const tone = dayTone(movers.total);
    return (
        <div className={`${PAD} shrink-0 pt-5 pb-4`}>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span className={`font-mono text-[2rem] font-bold leading-none tracking-tight tabular-nums sm:text-[2.5rem] ${tone.text}`}>
                            {fmt.signedMoney(movers.total)}
                        </span>
                        {/* Percentual NÃO é mascarado: é razão, não revela patrimônio —
                            mesma convenção da lista de ativos, que é o que este painel é. */}
                        <span className={`rounded-md px-1.5 py-0.5 font-mono text-[13px] font-bold tabular-nums ${tone.chip}`}>
                            {formatPercent(movers.totalPercent, { sign: true })}
                        </span>
                    </div>
                    {/* Sem denominador o número não tem escala: +R$ 39 é muito ou
                        pouco dependendo do tamanho da carteira. */}
                    {equity !== null && (
                        <p className="mt-2.5 text-[11.5px] text-slate-500">
                            de <span className="tabular-nums">{fmt.money(equity)}</span> em {assetCount}{' '}
                            {assetCount === 1 ? 'ativo' : 'ativos'}
                        </p>
                    )}
                </div>

                {movers.rows.length > 0 && <CompositionLegend movers={movers} unmeasuredCount={unmeasuredCount} />}
            </div>
        </div>
    );
};

/**
 * Motivo que vale para TODA a carteira é propriedade do dia, não da linha: uma
 * faixa no lugar de repetir a mesma etiqueta em cada uma.
 */
export const SharedReasonBanner: React.FC<{ movers: DayMovers; anchorLabel: string | null }> = ({ movers, anchorLabel }) => (
    <div className="mx-5 mb-4 flex shrink-0 items-start gap-2.5 rounded-xl border border-slate-700/70 bg-elevated px-3.5 py-2.5 sm:mx-7">
        <MoonStar size={14} className="mt-px shrink-0 text-slate-400" />
        <p className="text-xs leading-relaxed text-slate-300">
            {`Nenhum ativo negociou ${sinceAnchorText(anchorLabel)}.`}
            {' '}
            <span className="text-slate-500">
                {reasonDescription(movers.sharedReason)}
            </span>
        </p>
    </div>
);

interface ListProps {
    movers: DayMovers;
    groups: MoverGroup[];
    scale: number;
    fmt: MoneyFormatters;
}

const MoverGroupSection: React.FC<Omit<ListProps, 'groups'> & { group: MoverGroup }> = ({ group, movers, scale, fmt }) => (
    <section>
        <div className="flex items-center gap-2.5 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.07em]">
            <span className={group.labelClass}>{group.label}</span>
            <span className="font-mono text-slate-500">{group.rows.length}</span>
            <span className="h-px flex-1 bg-slate-800/70" aria-hidden="true" />
            {group.total !== null && (
                <span className="font-mono text-[11.5px] normal-case tracking-normal text-slate-400 tabular-nums">
                    {fmt.signedMoney(group.total)}
                </span>
            )}
        </div>

        {group.rows.map((row) => (
            <MoverRow
                key={row.id}
                row={row}
                scale={scale}
                // Com a faixa no topo, repetir a etiqueta em cada
                // linha só cansa: todas diriam a mesma coisa.
                hideReason={row.reason === movers.sharedReason}
                money={fmt.money}
                signedMoney={fmt.signedMoney}
            />
        ))}
    </section>
);

/** Lista rolável: cabeçalho de colunas grudado, grupos e a nota dos estáveis. */
export const DayMoversList: React.FC<ListProps> = ({ movers, groups, scale, fmt }) => (
    <div className={`min-h-0 flex-1 overflow-y-auto ${PAD}`}>
        {/* O cabeçalho mora DENTRO do scroller e gruda no topo. Fora
            dele, a barra de rolagem encolhia só as linhas: as colunas
            fixas saíam 10px do prumo dos rótulos. As margens negativas
            devolvem o fundo às bordas sem mexer na grade. */}
        <div className={`${GRID} ${PAD} sticky top-0 z-10 -mx-5 items-center border-y border-slate-800 bg-deep py-2.5 text-[9.5px] font-bold uppercase tracking-[0.09em] text-slate-500 sm:-mx-7`}>
            <span>Ativo</span>
            <span className="text-right">
                Contribuição<span className="hidden sm:inline"> no resultado</span>
            </span>
            <span className="text-right">No dia</span>
        </div>

        {groups.map((group) => (
            <MoverGroupSection key={group.key} group={group} movers={movers} scale={scale} fmt={fmt} />
        ))}

        {movers.flatCount > 0 ? (
            <p className="pt-4 pb-4 text-[11px] text-slate-500">
                {movers.flatCount === 1
                    ? '1 ativo negociou e fechou estável.'
                    : `${movers.flatCount} ativos negociaram e fecharam estáveis.`}
            </p>
        ) : (
            <div className="h-4" />
        )}
    </div>
);

/**
 * PU do Tesouro é publicado com atraso e pertence à própria data-base. Títulos
 * zerados por essa espera não competem com os movimentos de hoje: uma nota única
 * explica onde o valor está.
 */
const PendingTreasuryNote: React.FC<{ pending: DayMovers['pendingTreasury'] }> = ({ pending }) => (
    <div className="flex items-start gap-2.5">
        <Landmark size={13} className="mt-0.5 shrink-0 text-amber-400/80" />
        <p className="text-[11.5px] leading-relaxed text-slate-400">
            <span className="font-bold text-slate-300">Tesouro Direto.</span>{' '}
            {pending.count === 1 ? '1 título usa' : `${pending.count} títulos usam`}
            {' '}o último PU oficial
            {pending.latestPriceDate
                ? `, de ${formatShortDay(pending.latestPriceDate)}`
                : ''}
            . Como ainda não há PU de hoje, {pending.count === 1 ? 'ele não aparece' : 'eles não aparecem'} na lista de movimentos. A variação será incorporada ao fechamento de hoje assim que a fonte publicar.
        </p>
    </div>
);

/**
 * Proventos do dia-ex. FORA do total de propósito: a Variação Hoje é medida só
 * em preço, e somá-los aqui quebraria a identidade "patrimônio de ontem +
 * variação de hoje = hoje". Sem esta nota, o dia-ex aparece como prejuízo puro —
 * que é o que ele NÃO é.
 */
const DividendsNote: React.FC<{ movers: DayMovers; money: (v: number) => string }> = ({ movers, money }) => (
    <div className="flex items-start gap-2.5">
        <CircleDollarSign size={13} className="mt-0.5 shrink-0 text-gold" />
        <p className="text-[11.5px] leading-relaxed text-slate-400">
            {movers.dividendTickers.length > 0 && (
                <>
                    <span className="font-bold text-slate-300">
                        {movers.dividendTickers.join(', ')}
                    </span>
                    {movers.dividendTickers.length === 1 ? ' ficou ' : ' ficaram '}
                    <span className="font-bold text-gold">ex-provento</span>
                    {' — o preço caiu porque o rendimento saiu do ativo. '}
                </>
            )}
            Você recebeu <span className="font-mono font-bold tabular-nums text-gold">{money(movers.dividends)}</span>,
            que entram como proventos e não nesta conta de preço.
        </p>
    </div>
);

/** Rodapé fixo com as ressalvas do dia (Tesouro sem PU, proventos). */
export const DayMoversFooter: React.FC<{ movers: DayMovers; money: (v: number) => string }> = ({ movers, money }) => (
    <div className={`${PAD} shrink-0 space-y-2.5 border-t border-slate-800 bg-deep py-3.5`}>
        {movers.pendingTreasury.count > 0 && <PendingTreasuryNote pending={movers.pendingTreasury} />}
        {movers.dividends > 0 && <DividendsNote movers={movers} money={money} />}
    </div>
);
