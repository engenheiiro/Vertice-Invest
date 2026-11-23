import { formatCurrency } from './format';
import { reasonLabel, reasonTone, type DayMoverRow, type DayMovers } from './dayMovers';
import type { WalletKPIs } from '../contexts/WalletContext';

/**
 * Regras de exibição do modal "O dia da sua carteira" (`DayMoversModal`).
 * A conta do dia mora em `dayMovers.ts`; aqui só o que a tela decide: tom,
 * máscara, grupos, escala da barra e textos.
 */

export interface MoneyFormatters {
    money: (v: number) => string;
    signedMoney: (v: number) => string;
}

/**
 * Sem as setas de direção, o sinal vira o único marcador TEXTUAL do lado da
 * linha — cor sozinha não serve a quem não a distingue. No modo privacidade a
 * máscara volta intacta: "+••••••" não informa nada e ainda suja a coluna.
 */
export function moneyFormatters(isPrivacyMode: boolean): MoneyFormatters {
    const money = (v: number) => formatCurrency(v, 'BRL', { privacy: isPrivacyMode });
    const signedMoney = (v: number) => (isPrivacyMode || v <= 0 ? money(v) : `+${money(v)}`);
    return { money, signedMoney };
}

/** Cor do total do dia (texto e chip do percentual). */
export function dayTone(total: number): { text: string; chip: string } {
    const isUp = total > 0;
    const isFlat = total === 0;
    const text = isFlat ? 'text-slate-300' : isUp ? 'text-emerald-400' : 'text-red-400';
    const chip = isFlat
        ? 'bg-slate-700/40 text-slate-300'
        : isUp
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-red-500/10 text-red-400';
    return { text, chip };
}

/** Patrimônio que dá escala ao total; `null` quando não há um positivo. */
export const positiveEquity = (kpis?: Partial<WalletKPIs> | null): number | null =>
    typeof kpis?.totalEquity === 'number' && kpis.totalEquity > 0 ? kpis.totalEquity : null;

/** Escala das barras: a maior contribuição do dia, em módulo, é 100%. */
export const moverScale = (rows: DayMoverRow[]): number =>
    rows.reduce((max, r) => Math.max(max, Math.abs(r.value)), 0);

export interface MoverGroup {
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
export function groupMoverRows(rows: DayMoverRow[]): { list: MoverGroup[]; unmeasuredCount: number } {
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

const ASSET_CLASS_LABEL: Record<DayMoverRow['type'], string> = {
    STOCK: 'Ação',
    FII: 'FII',
    CRYPTO: 'Cripto',
    STOCK_US: 'Ação (EUA)',
    ETF: 'ETF',
    FIXED_INCOME: 'Renda Fixa',
    CASH: 'Reserva',
    OURO: 'Ouro',
};

/** "01/09" para uma chave de dia; a própria chave quando não é data. */
export const formatShortDay = (dayKey: string): string => {
    const date = new Date(`${dayKey}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return dayKey;
    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', timeZone: 'UTC',
    }).format(date);
};

/** O que a lista vazia diz, conforme o porquê de estar vazia. */
export function emptyMoversMessage(movers: DayMovers, anchorLabel: string | null): string {
    if (movers.flatCount > 0) {
        return `Nenhuma posição se moveu ${anchorLabel ? `desde o fechamento de ${anchorLabel}` : 'hoje'}.`;
    }
    return movers.pendingTreasury.count > 0
        ? 'Nenhuma posição com movimento publicado para detalhar.'
        : 'Nenhuma posição na carteira para detalhar.';
}

/** Frase da faixa/rodapé sobre o dia sem negócio, com ou sem a âncora nomeada. */
export const sinceAnchorText = (anchorLabel: string | null): string =>
    anchorLabel ? `desde o fechamento de ${anchorLabel}` : 'desde o fechamento anterior';

/** Tudo que uma linha precisa decidir antes de desenhar. */
export function moverRowView(row: DayMoverRow, scale: number, hideReason: boolean) {
    const isUp = row.value > 0;
    const isFlat = row.value === 0;
    const isReserve = row.type === 'CASH' || row.isReserve;
    const assetClass = ASSET_CLASS_LABEL[row.type];
    return {
        isUp,
        isFlat,
        isReserve,
        assetClass,
        assetLabel: isReserve ? row.name : `${row.ticker} · ${assetClass}`,
        valueClass: isFlat ? 'text-slate-500' : isUp ? 'text-emerald-400' : 'text-red-400',
        label: hideReason ? null : reasonLabel(row.reason),
        tone: reasonTone(row.reason),
        // Piso de 2%: uma contribuição de centavos ainda tem de deixar rastro na
        // barra, senão a linha parece não ter se movido.
        width: scale > 0 ? Math.max(2, (Math.abs(row.value) / scale) * 100) : 0,
    };
}
