/**
 * Resolução (PURA) do indexador de um título de renda fixa no cadastro da carteira.
 *
 * O que o usuário informa no formulário manda; o catálogo do Tesouro
 * (`TreasuryBond`) entra como fonte autoritativa quando o índice não veio da UI —
 * é o caminho que o cadastro por busca usa, onde o usuário só escolhe o título.
 *
 * Por que isso importa: o índice e o spread gravados aqui são o que a curva de
 * accrual usa daí em diante (`utils/fixedIncome.js`). Um catálogo errado vira
 * rendimento errado na carteira, todo dia, sem nada na tela denunciando —
 * "Tesouro Reserva 2036" chegou a ser catalogado como IPCA + 14% quando é Selic
 * com spread zero (o dobro do rendimento real).
 *
 * Spread zero é resposta legítima: pós-fixado puro acompanha o índice sem ágio.
 */

const INDEXED = ['SELIC', 'CDI', 'IPCA'];

/**
 * @param {object} input
 * @param {string} [input.index]  índice informado no formulário
 * @param {number} [input.spread] spread informado no formulário
 * @param {object} [input.bond]   documento do catálogo (`{ index, rate }`)
 * @returns {{index: string, spread: number}|null} nulo quando não há indexador
 *   reconhecível — o chamador então não toca nos campos do ativo.
 */
export const resolveFixedIncomeIndexing = ({ index, spread, bond } = {}) => {
    let idx = index;
    let spr = spread;

    // Só completa o que faltou: um índice vindo da UI nunca é sobrescrito pelo
    // catálogo, e um spread informado (inclusive 0) nunca é substituído.
    if (!idx && bond?.index) {
        idx = bond.index;
        if (spr == null) spr = bond.rate;
    }

    if (INDEXED.includes(idx)) return { index: idx, spread: Number(spr) || 0 };
    // Prefixado não tem spread sobre índice: a taxa cheia mora em fixedIncomeRate.
    if (idx === 'PRE') return { index: 'PRE', spread: null };
    return null;
};

export default resolveFixedIncomeIndexing;
