/**
 * Auditoria (PURA) do catálogo do Tesouro (`TreasuryBond`).
 *
 * O catálogo é a fonte que a vitrine exibe E que o cadastro da carteira copia para
 * a posição: o índice e o spread gravados ali viram a curva de accrual do usuário.
 * Um defeito aqui não aparece como erro em lugar nenhum — vira rendimento errado,
 * todo dia, em silêncio.
 *
 * As três invariantes abaixo são exatamente os três defeitos encontrados em
 * 30/08/2026, cada um invisível para os alarmes que já existiam:
 *
 *  1. DUPLICATA — a fonte mudou a marcação, o selo "Juros Semestrais" passou a vir
 *     colado ao nome e o upsert por título criou um segundo documento. Quatro
 *     emissões (3 IPCA+ e 1 Prefixado) apareciam duas vezes na vitrine, uma delas
 *     congelada há cinco meses.
 *  2. TAXA FORA DA FAIXA DA FAMÍLIA — "Tesouro Reserva 2036" catalogado como
 *     IPCA + 14,00% (a rentabilidade ESTIMADA lida como contratada). Nenhum cupom
 *     real de NTN-B chegou perto de 14%; quem cadastrasse levava 18,44% a.a. para
 *     a curva no lugar de 14,00%.
 *  3. MÍNIMO ACIMA DO PU — pedir R$ 30,00 de investimento mínimo num título que
 *     custa R$ 10,93 inteiro.
 *
 * O frescor entra junto porque foi o que denunciou a duplicata: num catálogo
 * saudável todos os títulos são reescritos no mesmo sync, então um documento
 * muito mais velho que os outros é órfão de uma marcação antiga.
 */

/**
 * Faixa plausível da taxa CONTRATADA por família. São grandezas diferentes:
 * IPCA-indexados guardam o cupom REAL, Selic guarda ágio/deságio sobre o índice e
 * Prefixado guarda a taxa nominal cheia — comparar todas contra uma faixa só é o
 * que deixou 14% passar por cupom real.
 */
export const CATALOG_RATE_RANGES = {
    IPCA: { min: 0, max: 10 },
    RENDAMAIS: { min: 0, max: 10 },
    EDUCA: { min: 0, max: 10 },
    SELIC: { min: -1, max: 3 },
    PREFIXADO: { min: 5, max: 25 },
};

/** Índice coerente com a família. Renda+/Educa+ são IPCA-indexados. */
const EXPECTED_INDEX = {
    IPCA: 'IPCA',
    RENDAMAIS: 'IPCA',
    EDUCA: 'IPCA',
    SELIC: 'SELIC',
    PREFIXADO: 'PRE',
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Mesma normalização da ingestão: descola o selo grudado no número. */
const normalize = (title) =>
    String(title || '').replace(/\s+/g, ' ').replace(/(\d)(?=[A-ZÀ-Ú])/g, '$1 ').trim();

const daysBetween = (from, to) => {
    const a = from instanceof Date ? from : new Date(from);
    if (!a || Number.isNaN(a.getTime())) return null;
    return Math.floor((to.getTime() - a.getTime()) / 86400000);
};

/**
 * @param {Array} bonds documentos de TreasuryBond (lean)
 * @param {Object} [opts] `{ now }`
 * @returns {{total:number, duplicates:Array, glued:Array, implausibleRate:Array,
 *            wrongIndex:Array, minAbovePu:Array, missingPrice:Array,
 *            oldestDays:number|null, issues:number}}
 */
export const auditTreasuryCatalog = (bonds = [], { now = new Date() } = {}) => {
    const list = Array.isArray(bonds) ? bonds : [];

    const byNormalized = new Map();
    for (const b of list) {
        const key = normalize(b?.title).toLowerCase();
        if (!byNormalized.has(key)) byNormalized.set(key, []);
        byNormalized.get(key).push(b);
    }

    const duplicates = [...byNormalized.values()]
        .filter((group) => group.length > 1)
        .map((group) => ({
            title: normalize(group[0]?.title),
            variants: group.map((b) => b?.title),
        }));

    const glued = list.filter((b) => normalize(b?.title) !== String(b?.title || '').trim())
        .map((b) => b.title);

    const implausibleRate = [];
    const wrongIndex = [];
    const minAbovePu = [];
    const missingPrice = [];
    let oldestDays = null;

    for (const b of list) {
        const range = CATALOG_RATE_RANGES[b?.type];
        const rate = num(b?.rate);
        if (range && (rate === null || rate < range.min || rate > range.max)) {
            implausibleRate.push({ title: b?.title, type: b?.type, rate });
        }

        const expected = EXPECTED_INDEX[b?.type];
        if (expected && b?.index && b.index !== expected) {
            wrongIndex.push({ title: b?.title, type: b?.type, index: b.index });
        }

        const pu = num(b?.unitPrice) ?? 0;
        const min = num(b?.minInvestment) ?? 0;
        if (pu <= 0) missingPrice.push(b?.title);
        else if (min > pu) minAbovePu.push({ title: b?.title, min, pu });

        const age = b?.updatedAt ? daysBetween(b.updatedAt, now) : null;
        if (age !== null && (oldestDays === null || age > oldestDays)) oldestDays = age;
    }

    return {
        total: list.length,
        duplicates,
        glued,
        implausibleRate,
        wrongIndex,
        minAbovePu,
        missingPrice,
        oldestDays,
        issues: duplicates.length + implausibleRate.length + wrongIndex.length
            + minAbovePu.length + missingPrice.length,
    };
};

export default auditTreasuryCatalog;
