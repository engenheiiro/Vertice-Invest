import type { AnchorRankingItem } from '../services/research';

/**
 * Traduz o par (action, bloqueadores) da lista âncora em UM status legível.
 *
 * O motor decide em dois passos: primeiro o portão (quem não passa nem aparece),
 * depois o COMPRAR — que exige score, preço justo, renda operacional e vaga na
 * composição da carteira publicável. Quem falha em qualquer um desses vira
 * `action: 'WAIT'`, e a tela mostrava tudo como um balde só de "Aguardando".
 *
 * Só que os motivos NÃO são equivalentes para quem lê. "Ótima âncora, o preço é
 * que subiu" é instrução de acompanhamento; "a lista já leva dois fundos desta
 * gestora" não é nem crítica ao fundo; "a distribuição deixou de ser coberta
 * pelo FFO" é defeito de tese. Jogar os três em AGUARDAR faz o assinante
 * suspeitar de todos igualmente — que é o oposto do que a apuração apurou.
 *
 * A classificação é DERIVADA: lê os mesmos campos que o motor gravou
 * (`anchor.expensive`, `publicationLimit`, `payoutUncovered`, `composite`) e
 * respeita a MESMA precedência dos motivos escritos no servidor
 * (`buildReason` no motor de FIIs, `blockersOf` em `anchorPublicationService`).
 * Nada aqui reclassifica ativo: `action: 'BUY'` continua sendo a única coisa que
 * define COMPRAR. Derivar em vez de gravar um campo novo também vale para os
 * relatórios JÁ publicados, que não seriam reprocessados.
 */

export type AnchorStatusId = 'BUY' | 'PRICE' | 'COMPOSITION' | 'INCOME' | 'CONVICTION';

export type AnchorStatusTone = 'emerald' | 'yellow' | 'blue' | 'orange' | 'slate';

export interface AnchorStatus {
    id: AnchorStatusId;
    /** Selo curto no cartão do ativo. É indicador, não botão. */
    label: string;
    /** Título da seção que agrupa o status. */
    section: string;
    /** Uma linha dizendo o que o grupo significa. */
    description: string;
    /** Rótulo compacto para contadores e legendas. */
    short: string;
    tone: AnchorStatusTone;
}

const STATUS: Record<AnchorStatusId, AnchorStatus> = {
    BUY: {
        id: 'BUY',
        label: 'COMPRAR',
        short: 'Para comprar',
        section: 'Para comprar',
        description: 'Âncora aprovada no portão e negociando dentro do valor justo.',
        tone: 'emerald',
    },
    PRICE: {
        id: 'PRICE',
        label: 'AGUARDANDO PREÇO',
        short: 'Aguardando preço',
        section: 'Aguardando preço',
        description: 'O negócio convence, o preço é que não. São âncoras boas esperando ponto de entrada — acompanhar, não descartar.',
        tone: 'yellow',
    },
    COMPOSITION: {
        id: 'COMPOSITION',
        label: 'LIMITE DE CARTEIRA',
        short: 'Limite de carteira',
        section: 'Fora por composição da carteira',
        description: 'Passariam no COMPRAR, mas a lista já leva o máximo de fundos de papel ou da mesma gestora. O limite é de carteira, não demérito do fundo.',
        tone: 'blue',
    },
    INCOME: {
        id: 'INCOME',
        label: 'RENDA NÃO COBERTA',
        short: 'Renda não coberta',
        section: 'Renda não operacional',
        description: 'A distribuição deixou de ser coberta pelo FFO: o provento veio de ganho de capital ou amortização, não da operação.',
        tone: 'orange',
    },
    CONVICTION: {
        id: 'CONVICTION',
        label: 'EM OBSERVAÇÃO',
        short: 'Em observação',
        section: 'Em observação',
        description: 'Passaram no portão de segurança, mas algum eixo ainda não sustenta a tese de carregar por décadas.',
        tone: 'slate',
    },
};

/** Ordem de exibição das seções: do acionável ao informativo. */
export const ANCHOR_STATUS_ORDER: AnchorStatusId[] = ['BUY', 'PRICE', 'COMPOSITION', 'INCOME', 'CONVICTION'];

export const anchorStatusById = (id: AnchorStatusId): AnchorStatus => STATUS[id];

/**
 * @param entryScore limiar de entrada da apuração (o motor usa 70; o relatório
 * publica o valor efetivo em `inputManifest.thresholds`).
 */
export const resolveAnchorStatus = (item: AnchorRankingItem, entryScore = 70): AnchorStatus => {
    if (item.action === 'BUY') return STATUS.BUY;

    const anchor = item.anchor;
    // Precedência igual à do servidor: o defeito de tese nomeia o item antes de
    // qualquer consideração de preço ou de vaga.
    if (anchor?.payoutUncovered) return STATUS.INCOME;
    if (anchor?.publicationLimit) return STATUS.COMPOSITION;

    // `composite` é a convicção ANTES do freio de preço — é o número que separa
    // "boa e cara" de "cara e fraca". Relatório antigo sem o campo cai no score,
    // que já vem com o freio descontado e por isso só erra para o lado seguro.
    const conviction = Number.isFinite(anchor?.composite as number)
        ? (anchor?.composite as number)
        : item.score;
    if (anchor?.expensive && conviction >= entryScore) return STATUS.PRICE;

    return STATUS.CONVICTION;
};

export interface AnchorStatusGroup {
    status: AnchorStatus;
    items: AnchorRankingItem[];
}

/** Agrupa o ranking nas seções da página, na ordem canônica. Grupos vazios saem fora. */
export const groupByAnchorStatus = (
    items: AnchorRankingItem[],
    entryScore = 70,
): AnchorStatusGroup[] => {
    const buckets = new Map<AnchorStatusId, AnchorRankingItem[]>();
    for (const item of items) {
        const { id } = resolveAnchorStatus(item, entryScore);
        const bucket = buckets.get(id);
        if (bucket) bucket.push(item);
        else buckets.set(id, [item]);
    }
    return ANCHOR_STATUS_ORDER
        .filter(id => buckets.has(id))
        .map(id => ({ status: STATUS[id], items: buckets.get(id) as AnchorRankingItem[] }));
};

/** Score médio da lista publicada. `null` quando não há score numérico algum. */
export const averageAnchorScore = (items: AnchorRankingItem[]): number | null => {
    const scores = items.map(item => Number(item.score)).filter(Number.isFinite);
    if (!scores.length) return null;
    return scores.reduce((total, score) => total + score, 0) / scores.length;
};
