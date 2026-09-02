import React from 'react';
import { ArrowDownRight, ArrowUpRight, CircleDollarSign, Landmark, Minus, MoonStar } from 'lucide-react';
import { Modal } from '../ui';
import AssetLogo from '../common/AssetLogo';
import { useWallet } from '../../contexts/WalletContext';
import { formatCurrency as fmtCurrency, formatPercent } from '../../utils/format';
import {
    buildDayMovers, formatAnchorLabel, reasonDescription, reasonLabel, reasonTone,
    type DayMoverRow,
} from '../../utils/dayMovers';

interface DayMoversModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * "O dia da sua carteira": de quais posições veio a Variação Hoje.
 *
 * O total no cabeçalho é o MESMO número do card que abriu este modal — vem de
 * `kpis.dayVariation`, e as linhas abaixo são as contribuições que o servidor
 * mediu contra o snapshot-âncora. Nenhuma soma acontece aqui: se a tela
 * recalculasse, ela viraria uma terceira versão da verdade sobre o dia, que é
 * exatamente o problema que a âncora do dia resolveu no servidor.
 */
export const DayMoversModal: React.FC<DayMoversModalProps> = ({ isOpen, onClose }) => {
    const { assets, kpis, isPrivacyMode } = useWallet();
    const movers = React.useMemo(() => buildDayMovers(assets, kpis), [assets, kpis]);

    const money = (v: number) => fmtCurrency(v, 'BRL', { privacy: isPrivacyMode });
    const anchorLabel = formatAnchorLabel(movers.anchorDate);
    const isUp = movers.total > 0;
    const isFlat = movers.total === 0;
    const toneClass = isFlat ? 'text-slate-300' : isUp ? 'text-emerald-400' : 'text-red-400';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-2xl"
            title={
                <span className="block">
                    <span className="block">O dia da sua carteira</span>
                    <span className="mt-0.5 block text-[11px] font-medium text-slate-500">
                        {anchorLabel
                            ? `desde o fechamento de ${anchorLabel}`
                            : 'desde o fechamento anterior'}
                    </span>
                </span>
            }
        >
            <div className="max-h-[70vh] overflow-y-auto">
                {/* Cabeçalho: o total é o do card, repetido aqui para o usuário ver
                    de onde a lista parte. */}
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 px-6 pt-5 pb-4">
                    <span className={`text-3xl font-extrabold tracking-tight tabular-nums ${toneClass}`}>
                        {isUp ? '+' : ''}{money(movers.total)}
                    </span>
                    {/* Percentual NÃO é mascarado: é razão, não revela patrimônio —
                        mesma convenção da lista de ativos, que é o que este painel é. */}
                    <span className={`text-sm font-bold tabular-nums ${toneClass}`}>
                        {formatPercent(movers.totalPercent, { sign: true })}
                    </span>
                    {movers.rows.length > 0 && (
                        <span className="ml-auto flex items-center gap-3 text-[11px] font-semibold text-slate-500">
                            <span><span className="text-emerald-400">{movers.upCount}</span> em alta</span>
                            <span><span className="text-red-400">{movers.downCount}</span> em queda</span>
                        </span>
                    )}
                </div>

                {/* Motivo que vale para TODA a carteira é propriedade do dia, não da
                    linha: uma faixa no lugar de repetir a mesma etiqueta em cada uma. */}
                {movers.sharedReason && (
                    <div className="mx-6 mb-4 flex items-start gap-2.5 rounded-xl border border-slate-700/70 bg-elevated px-3.5 py-2.5">
                        <MoonStar size={14} className="mt-px shrink-0 text-slate-400" />
                        <p className="text-xs leading-relaxed text-slate-300">
                            {anchorLabel
                                ? `Nenhum ativo negociou desde o fechamento de ${anchorLabel}.`
                                : 'Nenhum ativo negociou desde o fechamento anterior.'}
                            {' '}
                            <span className="text-slate-500">
                                {reasonDescription(movers.sharedReason)}
                            </span>
                        </p>
                    </div>
                )}

                {movers.rows.length === 0 ? (
                    <p className="px-6 pb-6 text-sm text-slate-400">
                        {movers.flatCount > 0
                            ? `Nenhuma posição se moveu ${anchorLabel ? `desde o fechamento de ${anchorLabel}` : 'hoje'}.`
                            : movers.pendingTreasury.count > 0
                                ? 'Nenhuma posição com movimento publicado para detalhar.'
                                : 'Nenhuma posição na carteira para detalhar.'}
                    </p>
                ) : (
                    <div className="px-6">
                        <div className="grid grid-cols-[minmax(0,1fr)_88px_54px] items-center gap-2 border-b border-slate-800 pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600 sm:grid-cols-[minmax(0,1fr)_108px_64px] sm:gap-3">
                            <span>Ativo</span>
                            <span className="text-right">Contribuição</span>
                            <span className="text-right">No dia</span>
                        </div>

                        {movers.rows.map((row) => (
                            <MoverRow
                                key={row.id}
                                row={row}
                                // Com a faixa no topo, repetir a etiqueta em cada
                                // linha só cansa: todas diriam a mesma coisa.
                                hideReason={row.reason === movers.sharedReason}
                                money={money}
                            />
                        ))}
                    </div>
                )}

                {movers.flatCount > 0 && movers.rows.length > 0 && (
                    <p className="px-6 pt-3 text-[11px] text-slate-500">
                        {movers.flatCount === 1
                            ? '1 ativo negociou e fechou estável.'
                            : `${movers.flatCount} ativos negociaram e fecharam estáveis.`}
                    </p>
                )}

                {/* PU do Tesouro é publicado com atraso e pertence à própria
                    data-base. Títulos zerados por essa espera não competem com os
                    movimentos de hoje: uma nota única explica onde o valor está. */}
                {movers.pendingTreasury.count > 0 && (
                    <div className="mx-6 mb-6 mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3.5 py-3">
                        <Landmark size={15} className="mt-px shrink-0 text-amber-400" />
                        <p className="text-xs leading-relaxed text-slate-300">
                            <span className="font-bold text-slate-200">Tesouro Direto.</span>{' '}
                            {movers.pendingTreasury.count === 1 ? '1 título usa' : `${movers.pendingTreasury.count} títulos usam`}
                            {' '}o último PU oficial
                            {movers.pendingTreasury.latestPriceDate
                                ? `, de ${formatShortDay(movers.pendingTreasury.latestPriceDate)}`
                                : ''}
                            . Como ainda não há PU de hoje, {movers.pendingTreasury.count === 1 ? 'ele não aparece' : 'eles não aparecem'} na lista de movimentos. A variação será incorporada ao fechamento de hoje assim que a fonte publicar.
                        </p>
                    </div>
                )}

                {/* Proventos do dia-ex. FORA do total de propósito: a Variação Hoje é
                    medida só em preço, e somá-los aqui quebraria a identidade
                    "patrimônio de ontem + variação de hoje = hoje". Sem esta nota, o
                    dia-ex aparece como prejuízo puro — que é o que ele NÃO é. */}
                {movers.dividends > 0 && (
                    <div className="mx-6 mb-6 mt-4 flex items-start gap-2.5 rounded-xl border border-gold/25 bg-gold/[0.06] px-3.5 py-3">
                        <CircleDollarSign size={15} className="mt-px shrink-0 text-gold" />
                        <p className="text-xs leading-relaxed text-slate-300">
                            {movers.dividendTickers.length > 0 && (
                                <>
                                    <span className="font-bold text-slate-200">
                                        {movers.dividendTickers.join(', ')}
                                    </span>
                                    {movers.dividendTickers.length === 1 ? ' ficou ' : ' ficaram '}
                                    <span className="font-bold text-gold">ex-provento</span>
                                    {' — o preço caiu porque o rendimento saiu do ativo. '}
                                </>
                            )}
                            Você recebeu <span className="font-bold tabular-nums text-gold">{money(movers.dividends)}</span>,
                            que entram como proventos e não nesta conta de preço.
                        </p>
                    </div>
                )}
            </div>
        </Modal>
    );
};

interface MoverRowProps {
    row: DayMoverRow;
    hideReason: boolean;
    money: (v: number) => string;
}

const MoverRow: React.FC<MoverRowProps> = ({ row, hideReason, money }) => {
    const isUp = row.value > 0;
    const isFlat = row.value === 0;
    const isReserve = row.type === 'CASH' || row.isReserve;
    const assetClass = assetClassLabel(row.type);
    const assetLabel = isReserve ? row.name : `${row.ticker} · ${assetClass}`;
    const valueClass = isFlat ? 'text-slate-500' : isUp ? 'text-emerald-500' : 'text-red-500';
    const label = hideReason ? null : reasonLabel(row.reason);
    const tone = reasonTone(row.reason);

    return (
        <div className="grid grid-cols-[minmax(0,1fr)_88px_54px] items-center gap-2 border-b border-slate-800/60 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_108px_64px] sm:gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
                <AssetLogo
                    ticker={row.ticker}
                    type={row.type}
                    currency={row.currency}
                    name={row.name}
                    sector={row.sector}
                    isReserve={row.isReserve}
                    size={28}
                    rounded="lg"
                    className="shrink-0"
                />
                <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                    <span
                        title={assetLabel}
                        className="min-w-0 truncate text-[13px] font-bold text-slate-100"
                    >
                        {isReserve ? row.name : row.ticker}
                        {!isReserve && (
                            <span className="font-medium text-slate-500"> · {assetClass}</span>
                        )}
                    </span>
                        {label && (
                            <span
                                title={reasonDescription(row.reason) ?? undefined}
                                className={`shrink-0 rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${
                                    tone === 'warning'
                                        ? 'border border-yellow-500/25 bg-yellow-500/10 text-yellow-500'
                                        : 'border border-slate-700 bg-slate-800/60 text-slate-400'
                                }`}
                            >
                                {label}
                            </span>
                        )}
                        {row.dividends > 0 && (
                            <span
                                title={`Ficou ex-provento: ${money(row.dividends)} creditados como proventos.`}
                                className="shrink-0 rounded border border-gold/25 bg-gold/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-gold"
                            >
                                ex-provento
                            </span>
                        )}
                </div>
            </div>

            <div className={`flex items-center justify-end gap-1 text-[13px] font-bold tabular-nums ${valueClass}`}>
                {isFlat ? <Minus size={11} /> : isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                {money(row.value)}
            </div>

            <div className="text-right text-[11px] tabular-nums text-slate-500">
                {formatPercent(row.percent, { sign: true })}
            </div>
        </div>
    );
};

const assetClassLabel = (type: DayMoverRow['type']): string => {
    switch (type) {
        case 'STOCK': return 'Ação';
        case 'FII': return 'FII';
        case 'CRYPTO': return 'Cripto';
        case 'STOCK_US': return 'Ação (EUA)';
        case 'ETF': return 'ETF';
        case 'FIXED_INCOME': return 'Renda Fixa';
        case 'CASH': return 'Reserva';
        case 'OURO': return 'Ouro';
    }
};

const formatShortDay = (dayKey: string): string => {
    const date = new Date(`${dayKey}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return dayKey;
    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', timeZone: 'UTC',
    }).format(date);
};
