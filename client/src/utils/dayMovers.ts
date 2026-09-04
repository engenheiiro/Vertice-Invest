import type { Asset, AssetType, DayChangeReason, WalletKPIs } from '../contexts/WalletContext';

/**
 * Detalhamento da Variação Hoje: de quais posições veio o número do card.
 *
 * Duas regras governam este arquivo, e as duas existem para o painel não virar
 * uma terceira versão da verdade:
 *
 *  1. O TOTAL VEM DO KPI, nunca da soma das linhas. O servidor mede o início do
 *     dia contra o snapshot-âncora e arredonda uma vez; as linhas são o MESMO
 *     cálculo, já reconciliadas ao centavo do outro lado. Somar aqui só
 *     reintroduziria a chance de divergir do card que o painel abre.
 *
 *  2. NÃO ESCONDEMOS O QUE NÃO SABEMOS. Zero tem duas origens: o ativo negociou
 *     e fechou estável (fato do mercado — agrupável, não há o que explicar), ou
 *     não temos como medir (cotação de outra sessão, ticker sem cotação, título
 *     vencido). O segundo é uma afirmação sobre o NOSSO dado e fica visível, com
 *     a etiqueta. Agrupar os dois num contador anônimo apagaria a diferença.
 */

/** Abaixo de meio centavo a contribuição não tem como ser exibida. */
const FLAT_THRESHOLD = 0.005;

export interface DayMoverRow {
    id: string;
    ticker: string;
    name: string;
    /** Metadados visuais repassados ao mesmo AssetLogo do Detalhamento. */
    type: AssetType;
    currency: 'BRL' | 'USD';
    sector: string | null;
    isReserve: boolean;
    /** Contribuição em BRL para a Variação Hoje. */
    value: number;
    /** Variação percentual da posição no dia (preço + câmbio). */
    percent: number;
    reason: DayChangeReason | null;
    /** Provento com data-ex na janela do dia; 0 na maioria das linhas. */
    dividends: number;
}

export interface PendingTreasurySummary {
    count: number;
    /** Data-base do PU que já está incorporado ao fechamento anterior. */
    latestPriceDate: string | null;
}

export interface DayMovers {
    /** Ordenadas da maior alta para a maior queda. */
    rows: DayMoverRow[];
    upCount: number;
    downCount: number;
    /** Ativos que negociaram e fecharam estáveis — agrupados, fora de `rows`. */
    flatCount: number;
    /** Autoridade: vem de `kpis.dayVariation`. */
    total: number;
    totalPercent: number;
    dividends: number;
    dividendTickers: string[];
    anchorDate: string | null;
    /** Tesouros sem PU do dia ficam numa nota única, fora da lista de movimentos. */
    pendingTreasury: PendingTreasurySummary;
    /**
     * Preenchido quando TODAS as linhas de mercado compartilham o mesmo motivo
     * degradado — fim de semana, feriado, ou antes da B3 abrir. Um motivo que
     * vale para todo mundo é propriedade do DIA, não da linha: a UI mostra uma
     * faixa única em vez de repetir a mesma etiqueta em dez lugares.
     */
    sharedReason: DayChangeReason | null;
}

/** Motivos em que o zero é nosso, não do mercado — a linha nunca é agrupada. */
const ZEROED_BY_DATA: ReadonlySet<DayChangeReason> = new Set<DayChangeReason>([
    'STALE_QUOTE', 'NO_QUOTE', 'MATURED', 'FIXED_INCOME_MTM_PENDING',
]);

/** Motivos que respondem exatamente o que a linha promete — sem etiqueta. */
const DEFAULT_REASONS: ReadonlySet<DayChangeReason> = new Set<DayChangeReason>([
    'ANCHOR_CLOSE', 'PREVIOUS_CLOSE',
]);

/** Motivos da renda fixa: não entram na conta da faixa de mercado fechado. */
const FIXED_INCOME_REASONS: ReadonlySet<DayChangeReason> = new Set<DayChangeReason>([
    'FIXED_INCOME_MTM', 'FIXED_INCOME_MTM_PENDING', 'FIXED_INCOME_CURVE',
]);

export const isDefaultReason = (reason: DayChangeReason | null | undefined): boolean =>
    !!reason && DEFAULT_REASONS.has(reason);

export const isZeroedByData = (reason: DayChangeReason | null | undefined): boolean =>
    !!reason && ZEROED_BY_DATA.has(reason);

/** Rótulo curto exibido na linha. `null` = sem etiqueta (caso normal). */
export const reasonLabel = (reason: DayChangeReason | null | undefined): string | null => {
    switch (reason) {
        case 'BOUGHT_TODAY': return 'comprado hoje';
        case 'FIXED_INCOME_MTM': return 'marcado a mercado';
        case 'FIXED_INCOME_CURVE': return null;
        case 'FIXED_INCOME_MTM_PENDING': return 'PU de hoje não publicado';
        case 'MATURED': return 'vencido';
        case 'STALE_QUOTE': return 'sem negócio hoje';
        case 'NO_QUOTE': return 'sem cotação';
        case 'PROVIDER_WINDOW': return 'janela de 24h';
        case 'PROVIDER_SESSION': return 'sem fechamento de ontem';
        default: return null;
    }
};

/**
 * Tom da etiqueta. `neutral` = o cálculo é outro, mas está certo. `warning` = o
 * número está zerado ou vem de uma régua pior. São coisas diferentes e não podem
 * dividir a mesma cor.
 */
export const reasonTone = (reason: DayChangeReason | null | undefined): 'neutral' | 'warning' => {
    switch (reason) {
        case 'BOUGHT_TODAY':
        case 'FIXED_INCOME_MTM':
        case 'FIXED_INCOME_CURVE':
            return 'neutral';
        default:
            return 'warning';
    }
};

/** Texto explicativo por extenso, usado no `title` da etiqueta. */
export const reasonDescription = (reason: DayChangeReason | null | undefined): string | null => {
    switch (reason) {
        case 'BOUGHT_TODAY':
            return 'Comprado hoje: a variação é medida desde o preço que você pagou, não desde o fechamento anterior.';
        case 'FIXED_INCOME_MTM':
            return 'Marcado pelo preço unitário oficial do Tesouro publicado hoje.';
        case 'FIXED_INCOME_CURVE':
            return 'Rende pela taxa contratada (na curva). Não há preço público de mercado para este título.';
        case 'FIXED_INCOME_MTM_PENDING':
            return 'O preço unitário oficial de hoje ainda não saiu. Repetir a variação de ontem mostraria um movimento que não aconteceu.';
        case 'MATURED':
            return 'Título vencido: o valor está congelado e não rende mais.';
        case 'STALE_QUOTE':
            return 'A cotação mais recente é de uma sessão anterior — o ativo ainda não negociou hoje.';
        case 'NO_QUOTE':
            return 'Sem cotação disponível para este ativo no momento.';
        case 'PROVIDER_WINDOW':
            return 'Sem fechamento anterior registrado: a variação vem da janela de 24 horas da fonte, que não coincide com o dia.';
        case 'PROVIDER_SESSION':
            return 'Sem o fechamento de ontem registrado: a variação é a que a fonte reporta para a sessão.';
        default:
            return null;
    }
};

const displayName = (asset: Asset): string => asset.name || asset.ticker;

/**
 * "segunda-feira, 01/09" para o dia-âncora.
 *
 * O dia da semana entra por escolha: é ele que faz o leitor entender sozinho por
 * que a comparação de uma segunda-feira olha para sexta. UTC de propósito — a
 * chave é um DIA (YYYY-MM-DD), e lê-la no fuso local a joga para o dia anterior
 * em qualquer usuário a oeste de Greenwich.
 */
export const formatAnchorLabel = (anchorDate: string | null | undefined): string | null => {
    if (!anchorDate) return null;
    const date = new Date(`${anchorDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;

    const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(date);
    const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(date);
    return `${weekday}, ${day}`;
};

export function buildDayMovers(assets: Asset[], kpis?: Partial<WalletKPIs> | null): DayMovers {
    const total = kpis?.dayVariation ?? 0;
    const empty: DayMovers = {
        rows: [], upCount: 0, downCount: 0, flatCount: 0,
        total, totalPercent: kpis?.dayVariationPercent ?? 0,
        dividends: kpis?.dayDividends ?? 0, dividendTickers: [],
        anchorDate: kpis?.dayAnchorDate ?? null, sharedReason: null,
        pendingTreasury: { count: 0, latestPriceDate: null },
    };
    if (!Array.isArray(assets) || assets.length === 0) return empty;

    const rows: DayMoverRow[] = [];
    let flatCount = 0;
    let upCount = 0;
    let downCount = 0;
    const dividendTickers: string[] = [];
    let pendingTreasuryCount = 0;
    let pendingTreasuryPriceDate: string | null = null;

    for (const asset of assets) {
        const value = asset.dayChangeValue ?? 0;
        const reason = asset.dayChangeReason ?? null;
        const dividends = asset.dayDividends ?? 0;
        if (dividends > 0) dividendTickers.push(asset.ticker);

        // Um Tesouro sem PU do dia não é um movimento de hoje: o PU anterior já
        // foi incorporado ao fechamento da própria data-base. Em vez de ocupar
        // uma linha zerada por título, ele vira uma nota única no rodapé. Se por
        // alguma inconsistência a contribuição vier diferente de zero, a linha
        // permanece visível — nunca escondemos dinheiro que entrou no total.
        if (reason === 'FIXED_INCOME_MTM_PENDING' && Math.abs(value) < FLAT_THRESHOLD) {
            pendingTreasuryCount += 1;
            if (asset.priceDate && (!pendingTreasuryPriceDate || asset.priceDate > pendingTreasuryPriceDate)) {
                pendingTreasuryPriceDate = asset.priceDate;
            }
            continue;
        }

        // Zero de mercado: o ativo negociou e não se moveu. Agrupa.
        // Zero nosso (ou provento a explicar): permanece na lista.
        if (Math.abs(value) < FLAT_THRESHOLD && !isZeroedByData(reason) && dividends <= 0) {
            flatCount += 1;
            continue;
        }

        if (value > 0) upCount += 1;
        else if (value < 0) downCount += 1;
        rows.push({
            id: asset.id,
            ticker: asset.ticker,
            name: displayName(asset),
            type: asset.type,
            currency: asset.currency,
            sector: asset.sector ?? null,
            isReserve: asset.isReserve ?? asset.type === 'CASH',
            value,
            percent: asset.dayChangePct ?? 0,
            reason,
            dividends,
        });
    }

    // Maior alta → maior queda. Empate pelo ticker, para a ordem não oscilar
    // entre renderizações quando duas posições contribuem igual.
    rows.sort((a, b) => (b.value - a.value) || a.ticker.localeCompare(b.ticker));

    return {
        rows,
        upCount,
        downCount,
        flatCount,
        total,
        totalPercent: kpis?.dayVariationPercent ?? 0,
        dividends: kpis?.dayDividends ?? 0,
        dividendTickers,
        anchorDate: kpis?.dayAnchorDate ?? null,
        pendingTreasury: {
            count: pendingTreasuryCount,
            latestPriceDate: pendingTreasuryPriceDate,
        },
        sharedReason: resolveSharedReason(rows),
    };
}

/**
 * Um motivo degradado compartilhado por TODAS as linhas de mercado vira faixa.
 *
 * Sábado, feriado e o intervalo antes da abertura produzem a mesma cena: toda a
 * carteira em `STALE_QUOTE` de uma vez. Dez etiquetas âmbar dizendo a mesma
 * coisa não informam — cansam. A renda fixa fica de fora da conta porque ela
 * rende (ou é marcada) por regra própria e não depende do pregão.
 */
function resolveSharedReason(rows: DayMoverRow[]): DayChangeReason | null {
    const market = rows.filter((r) => r.reason && !FIXED_INCOME_REASONS.has(r.reason));
    if (market.length < 2) return null;

    const first = market[0].reason;
    if (!first || isDefaultReason(first)) return null;
    return market.every((r) => r.reason === first) ? first : null;
}
