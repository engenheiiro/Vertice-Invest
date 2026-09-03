import React from 'react';
import { CircleDollarSign, Landmark, MoonStar } from 'lucide-react';
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

/** Grade compartilhada pelo cabeçalho de colunas e pelas linhas. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_92px_52px] gap-2 sm:grid-cols-[minmax(0,1fr)_190px_78px] sm:gap-4';

/** Recuo lateral: 28px no desktop, como no protótipo; 20px no celular. */
const PAD = 'px-5 sm:px-7';

/**
 * "O dia da sua carteira": de quais posições veio a Variação Hoje.
 *
 * O total no cabeçalho é o MESMO número do card que abriu este modal — vem de
 * `kpis.dayVariation`, e as linhas abaixo são as contribuições que o servidor
 * mediu contra o snapshot-âncora. Nenhuma soma acontece aqui: se a tela
 * recalculasse, ela viraria uma terceira versão da verdade sobre o dia, que é
 * exatamente o problema que a âncora do dia resolveu no servidor.
 *
 * A única soma da tela é o SUBTOTAL POR GRUPO, e ela é sobre as linhas que o
 * usuário está vendo — é o que torna o saldo auditável sem disputar autoridade
 * com o KPI.
 */
export const DayMoversModal: React.FC<DayMoversModalProps> = ({ isOpen, onClose }) => {
    const { assets, kpis, isPrivacyMode } = useWallet();
    const movers = React.useMemo(() => buildDayMovers(assets, kpis), [assets, kpis]);
    const groups = React.useMemo(() => groupRows(movers.rows), [movers.rows]);

    /** Escala das barras: a maior contribuição do dia, em módulo, é 100%. */
    const scale = React.useMemo(
        () => movers.rows.reduce((max, r) => Math.max(max, Math.abs(r.value)), 0),
        [movers.rows],
    );

    const money = (v: number) => fmtCurrency(v, 'BRL', { privacy: isPrivacyMode });
    // Sem as setas de direção, o sinal vira o único marcador TEXTUAL do lado da
    // linha — cor sozinha não serve a quem não a distingue. No modo privacidade a
    // máscara volta intacta: "+••••••" não informa nada e ainda suja a coluna.
    const signedMoney = (v: number) => (isPrivacyMode || v <= 0 ? money(v) : `+${money(v)}`);
    const anchorLabel = formatAnchorLabel(movers.anchorDate);
    const isUp = movers.total > 0;
    const isFlat = movers.total === 0;
    const toneClass = isFlat ? 'text-slate-300' : isUp ? 'text-emerald-400' : 'text-red-400';
    const toneChip = isFlat
        ? 'bg-slate-700/40 text-slate-300'
        : isUp
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-red-500/10 text-red-400';

    const equity = typeof kpis?.totalEquity === 'number' && kpis.totalEquity > 0 ? kpis.totalEquity : null;
    const unmeasuredCount = movers.flatCount + groups.unmeasuredCount;
    const hasFooter = movers.pendingTreasury.count > 0 || movers.dividends > 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            // 700px é medida do protótipo e não existe na escala do Tailwind
            // (2xl=672, 3xl=768). Arredondar para 3xl engordava 78px a coluna do
            // ativo — toda a folga sobrava do lado que menos precisa dela.
            maxWidth="max-w-[700px]"
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
            {/* Resumo e rodapé ficam FORA da rolagem: as ressalvas do dia moravam no
                fim da lista, onde ninguém chega. Só a lista rola. */}
            <div className="flex max-h-[78vh] flex-col sm:max-h-[72vh]">
                {/* Cabeçalho: o total é o do card, repetido aqui para o usuário ver
                    de onde a lista parte. */}
                <div className={`${PAD} shrink-0 pt-5 pb-4`}>
                    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                                <span className={`font-mono text-[2rem] font-bold leading-none tracking-tight tabular-nums sm:text-[2.5rem] ${toneClass}`}>
                                    {signedMoney(movers.total)}
                                </span>
                                {/* Percentual NÃO é mascarado: é razão, não revela patrimônio —
                                    mesma convenção da lista de ativos, que é o que este painel é. */}
                                <span className={`rounded-md px-1.5 py-0.5 font-mono text-[13px] font-bold tabular-nums ${toneChip}`}>
                                    {formatPercent(movers.totalPercent, { sign: true })}
                                </span>
                            </div>
                            {/* Sem denominador o número não tem escala: +R$ 39 é muito ou
                                pouco dependendo do tamanho da carteira. */}
                            {equity !== null && (
                                <p className="mt-2.5 text-[11.5px] text-slate-500">
                                    de <span className="tabular-nums">{money(equity)}</span> em {assets.length}{' '}
                                    {assets.length === 1 ? 'ativo' : 'ativos'}
                                </p>
                            )}
                        </div>

                        {movers.rows.length > 0 && (
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
                        )}
                    </div>
                </div>

                {/* Motivo que vale para TODA a carteira é propriedade do dia, não da
                    linha: uma faixa no lugar de repetir a mesma etiqueta em cada uma. */}
                {movers.sharedReason && (
                    <div className="mx-5 mb-4 flex shrink-0 items-start gap-2.5 rounded-xl border border-slate-700/70 bg-elevated px-3.5 py-2.5 sm:mx-7">
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
                    <p className={`${PAD} pb-6 text-sm text-slate-400`}>
                        {movers.flatCount > 0
                            ? `Nenhuma posição se moveu ${anchorLabel ? `desde o fechamento de ${anchorLabel}` : 'hoje'}.`
                            : movers.pendingTreasury.count > 0
                                ? 'Nenhuma posição com movimento publicado para detalhar.'
                                : 'Nenhuma posição na carteira para detalhar.'}
                    </p>
                ) : (
                    <>
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

                            {groups.list.map((group) => (
                                <section key={group.key}>
                                    <div className="flex items-center gap-2.5 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.07em]">
                                        <span className={group.labelClass}>{group.label}</span>
                                        <span className="font-mono text-slate-500">{group.rows.length}</span>
                                        <span className="h-px flex-1 bg-slate-800/70" aria-hidden="true" />
                                        {group.total !== null && (
                                            <span className="font-mono text-[11.5px] normal-case tracking-normal text-slate-400 tabular-nums">
                                                {signedMoney(group.total)}
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
                                            money={money}
                                            signedMoney={signedMoney}
                                        />
                                    ))}
                                </section>
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
                    </>
                )}

                {hasFooter && (
                    <div className={`${PAD} shrink-0 space-y-2.5 border-t border-slate-800 bg-deep py-3.5`}>
                        {/* PU do Tesouro é publicado com atraso e pertence à própria
                            data-base. Títulos zerados por essa espera não competem com os
                            movimentos de hoje: uma nota única explica onde o valor está. */}
                        {movers.pendingTreasury.count > 0 && (
                            <div className="flex items-start gap-2.5">
                                <Landmark size={13} className="mt-0.5 shrink-0 text-amber-400/80" />
                                <p className="text-[11.5px] leading-relaxed text-slate-400">
                                    <span className="font-bold text-slate-300">Tesouro Direto.</span>{' '}
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
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
};

/**
 * Barra de composição do dia: quantas posições subiram, caíram e ficaram
 * paradas. Troca a contagem em texto solto por uma proporção que se enxerga
 * antes de ler.
 */
const CompositionBar: React.FC<{ up: number; down: number; flat: number }> = ({ up, down, flat }) => (
    <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {up > 0 && <div className="rounded-full bg-emerald-500" style={{ flex: up }} />}
        {down > 0 && <div className="rounded-full bg-red-500" style={{ flex: down }} />}
        {flat > 0 && <div className="rounded-full bg-slate-600" style={{ flex: flat }} />}
    </div>
);

interface MoverRowProps {
    row: DayMoverRow;
    scale: number;
    hideReason: boolean;
    money: (v: number) => string;
    signedMoney: (v: number) => string;
}

const MoverRow: React.FC<MoverRowProps> = ({ row, scale, hideReason, money, signedMoney }) => {
    const isUp = row.value > 0;
    const isFlat = row.value === 0;
    const isReserve = row.type === 'CASH' || row.isReserve;
    const assetClass = assetClassLabel(row.type);
    const assetLabel = isReserve ? row.name : `${row.ticker} · ${assetClass}`;
    const valueClass = isFlat ? 'text-slate-500' : isUp ? 'text-emerald-400' : 'text-red-400';
    const label = hideReason ? null : reasonLabel(row.reason);
    const tone = reasonTone(row.reason);
    // Piso de 2%: uma contribuição de centavos ainda tem de deixar rastro na
    // barra, senão a linha parece não ter se movido.
    const width = scale > 0 ? Math.max(2, (Math.abs(row.value) / scale) * 100) : 0;

    return (
        <div className={`${GRID} items-center border-b border-slate-800/50 py-2.5 last:border-b-0`}>
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
                {/* Etiqueta em LINHA PRÓPRIA. Ao lado do ticker ela disputava a
                    mesma largura e, no celular, vencia: "IVVB11 · ETF" sumia inteiro
                    e sobrava só o aviso — a linha perdia o nome do ativo. */}
                <div className="min-w-0">
                    <span
                        title={assetLabel}
                        className="block truncate text-[13px] font-bold text-slate-100"
                    >
                        {isReserve ? row.name : row.ticker}
                        {!isReserve && (
                            <span className="font-medium text-slate-500"> · {assetClass}</span>
                        )}
                    </span>
                    {/* Sem caixa nem borda: as etiquetas QUALIFICAM o número, não
                        competem com ele. Preenchidas em âmbar, eram o elemento mais
                        forte de uma tela cujo assunto é a coluna de reais. */}
                    {(label || row.dividends > 0) && (
                        <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-wide">
                            {label && (
                                <span
                                    title={reasonDescription(row.reason) ?? undefined}
                                    className={`truncate ${tone === 'warning' ? 'text-yellow-500/80' : 'text-slate-500'}`}
                                >
                                    {label}
                                </span>
                            )}
                            {row.dividends > 0 && (
                                <span
                                    title={`Ficou ex-provento: ${money(row.dividends)} creditados como proventos.`}
                                    className="shrink-0 text-gold/90"
                                >
                                    ex-provento
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Barra proporcional: torna visível quem EXPLICA o dia. Sem ela, duas
                posições que respondem por 60% do resultado ficam indistinguíveis das
                oito que respondem pelo resto. */}
            <div className="flex items-center justify-end gap-2.5">
                <div
                    className={`hidden h-[5px] flex-1 rounded-full bg-slate-800 sm:flex ${isUp ? 'justify-start' : 'justify-end'}`}
                    aria-hidden="true"
                >
                    {!isFlat && (
                        <div
                            className={`h-[5px] rounded-full ${isUp ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                            style={{ width: `${width}%` }}
                        />
                    )}
                </div>
                <span className={`w-[76px] shrink-0 text-right font-mono text-[13px] font-bold tabular-nums ${valueClass}`}>
                    {signedMoney(row.value)}
                </span>
            </div>

            <div className="text-right font-mono text-[11.5px] tabular-nums text-slate-500">
                {formatPercent(row.percent, { sign: true })}
            </div>
        </div>
    );
};

interface MoverGroup {
    key: 'up' | 'down' | 'unmeasured';
    label: string;
    labelClass: string;
    rows: DayMoverRow[];
    /** `null` quando somar não diz nada — o grupo é zero por construção. */
    total: number | null;
}

/**
 * Separa alta, queda e "sem variação medida".
 *
 * A lista virava de sinal no meio sem aviso: o leitor descobria a fronteira pela
 * cor. Com os grupos, cada lado ganha contagem e subtotal, e o saldo do dia fica
 * conferível linha a linha — sem que a tela dispute a autoridade do KPI, que
 * segue sendo o número do topo.
 */
function groupRows(rows: DayMoverRow[]): { list: MoverGroup[]; unmeasuredCount: number } {
    const sum = (list: DayMoverRow[]) => list.reduce((acc, r) => acc + r.value, 0);
    const up = rows.filter((r) => r.value > 0);
    const down = rows.filter((r) => r.value < 0);
    // Zero que sobrou na lista é zero NOSSO (sem cotação, PU pendente) ou linha
    // de provento — nunca o zero do mercado, que já foi agrupado no contador.
    const unmeasured = rows.filter((r) => r.value === 0);

    const list: MoverGroup[] = [
        { key: 'up', label: 'Em alta', labelClass: 'text-emerald-400', rows: up, total: sum(up) },
        { key: 'down', label: 'Em queda', labelClass: 'text-red-400', rows: down, total: sum(down) },
        { key: 'unmeasured', label: 'Sem variação medida', labelClass: 'text-slate-400', rows: unmeasured, total: null },
    ];

    return {
        list: list.filter((g) => g.rows.length > 0),
        unmeasuredCount: unmeasured.length,
    };
}

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
