import { toDateKey } from './dateUtils.js';
import {
    addQty,
    safeAdd,
    safeCurrency,
    safePrice,
    safeQuantity,
    safeSub,
    safeUnitPrice,
    safeValue,
    subQty,
} from './mathUtils.js';

/**
 * Regras puras da prévia de importação de carteira (`resolveRows`): situação de
 * cada linha e posição resultante por ticker. Nada aqui consulta o banco — o
 * serviço busca catálogo, posições e lançamentos e entrega os mapas prontos.
 */

/** Situação de uma linha na tela de conferência. */
export const ROW_STATUS = {
    OK: 'ok',
    DUPLICADO: 'duplicado',
    ATENCAO: 'atencao',
    NAO_RECONHECIDO: 'nao_reconhecido',
};

/**
 * Chave de dedup de um lançamento — o que torna dois lançamentos "o mesmo".
 *
 * Preço pela régua de PREÇO UNITÁRIO (`safeUnitPrice`, regra 7), não de dinheiro:
 * com `safeCurrency` duas compras de SHIB no mesmo dia e quantidade, a
 * US$ 0,00001234 e a US$ 0,00001567, viravam ambas `0` na chave — a segunda
 * era marcada como duplicata e ficava fora do import.
 */
export const dedupKey = ({ ticker, date, side, quantity, price }) =>
    [
        String(ticker).toUpperCase(),
        toDateKey(date),
        side,
        safeQuantity(quantity),
        safeUnitPrice(price),
    ].join('|');

/**
 * Precedência de tipo/moeda: escolha explícita do parser > catálogo > posição
 * já existente na carteira. Nunca chuta por formato de ticker — "termina em 11"
 * é FII, ETF ou unit, e errar isso desloca o ativo de classe na alocação inteira.
 */
const resolveRowClass = (row, known, position) => ({
    type: row.type || known?.type || position?.type || null,
    currency: row.currency || known?.currency || position?.currency || 'BRL',
    name: row.name || known?.name || null,
});

const classifyRow = (row, type, key, { alreadyThere, seenInBatch }) => {
    if (!row.ticker || !row.date) return { status: ROW_STATUS.NAO_RECONHECIDO, reason: 'Linha sem ticker ou data válida.' };
    if (!type) return { status: ROW_STATUS.NAO_RECONHECIDO, reason: 'Ativo fora do nosso catálogo. Escolha a classe para importar.' };
    if (alreadyThere.has(key)) return { status: ROW_STATUS.DUPLICADO, reason: 'Lançamento idêntico já existe nesta carteira.' };
    if (seenInBatch.has(key)) return { status: ROW_STATUS.DUPLICADO, reason: 'Linha repetida dentro do próprio arquivo.' };
    if (row.side === 'BUY' && row.price === 0) {
        return { status: ROW_STATUS.ATENCAO, reason: 'Compra com preço zerado — confira antes de importar.' };
    }
    return { status: ROW_STATUS.OK, reason: null };
};

/**
 * Classifica as linhas em ordem de data (o índice original volta no array de
 * saída para não embaralhar a tela de conferência). Duplicata dentro do próprio
 * arquivo conta a partir da primeira ocorrência cronológica.
 *
 * `soFaltaClasse`: só falta a CLASSE — escolhida nesta mesma tela. A linha vai
 * entrar, então conta no saldo e no resumo. Quem chama apaga a marca no fim.
 */
export const classifyInDateOrder = (normalized, { catalogByTicker, positionByTicker, alreadyThere }) => {
    const seenInBatch = new Set();
    const chronological = normalized
        .map((row, index) => ({ row, index }))
        .sort((a, b) => (a.row.date?.getTime() || 0) - (b.row.date?.getTime() || 0));

    const resolvedByIndex = new Array(normalized.length);
    for (const { row, index } of chronological) {
        const { type, currency, name } = resolveRowClass(row, catalogByTicker.get(row.ticker), positionByTicker.get(row.ticker));
        const key = dedupKey(row);
        const { status, reason } = classifyRow(row, type, key, { alreadyThere, seenInBatch });
        seenInBatch.add(key);
        const soFaltaClasse = status === ROW_STATUS.NAO_RECONHECIDO && !!row.ticker && !!row.date;
        resolvedByIndex[index] = { ...row, type, currency, name, status, reason, soFaltaClasse };
    }
    return resolvedByIndex;
};

/** Linha que de fato entraria no commit (inclui a que só espera a classe). */
const isImportable = (r) => r.status === ROW_STATUS.OK
    || r.status === ROW_STATUS.ATENCAO
    || (r.status === ROW_STATUS.NAO_RECONHECIDO && !!r.ticker && !!r.date);

/** Aplica as linhas sobre a quantidade inicial, por preço médio. */
const accumulate = (startQuantity, linhas) => {
    let quantity = startQuantity;
    let cost = 0;
    for (const linha of linhas) {
        if (linha.side === 'BUY') {
            quantity = addQty(quantity, linha.quantity);
            cost = safeAdd(cost, safeValue(linha.quantity, linha.price));
        } else {
            const avg = safePrice(cost, quantity);
            cost = safeSub(cost, safeValue(linha.quantity, avg));
            quantity = subQty(quantity, linha.quantity);
        }
    }
    return { quantity, cost };
};

/**
 * Posição resultante de um ticker — o material da conferência contra a origem.
 *
 * Linha que só espera a classe entra na conta. Fora dela, um Tesouro ou
 * qualquer ativo fora do catálogo aparecia com quantidade e valor ZERO na tela
 * de conferência — justamente o número que o usuário abriu a tela para
 * conferir, e que o commit ia gravar certo de qualquer jeito.
 */
export const summarizeTicker = (ticker, linhas, { catalogByTicker, positionByTicker }) => {
    const importaveis = linhas.filter(isImportable);
    const known = catalogByTicker.get(ticker);
    const { quantity, cost } = accumulate(safeQuantity(positionByTicker.get(ticker)?.quantity || 0), importaveis);
    return {
        ticker,
        type: importaveis[0]?.type || known?.type || null,
        name: known?.name || null,
        currency: importaveis[0]?.currency || 'BRL',
        rows: linhas.length,
        quantity: safeQuantity(quantity),
        averagePrice: quantity > 0 ? safeCurrency(safePrice(cost, quantity)) : 0,
        totalCost: safeCurrency(cost),
        hadPosition: positionByTicker.has(ticker),
    };
};
