/**
 * Identidade de um título do Tesouro Direto (PURO, sem I/O).
 *
 * Duas direções:
 *  1. CSV oficial → chave canônica  (`classifyTreasuryLabel`)
 *  2. posição do usuário → chave canônica (`resolveTreasuryTitleKey`)
 *
 * A chave é `FAMILIA|YYYY-MM-DD` (família + vencimento), porque é o par que
 * identifica um título de forma estável: o "Tipo Titulo" do CSV mudou de nome ao
 * longo dos anos (LTN/NTN-B/LFT → Tesouro Prefixado/IPCA+/Selic) e o vencimento
 * sozinho não distingue um Prefixado de um IPCA+ que vencem no mesmo ano.
 *
 * O casamento com a posição do usuário é DELIBERADAMENTE conservador: só marca a
 * mercado o que dá para identificar sem ambiguidade. Um CDB "PÓS-FIXADO - Nubank"
 * ou uma LCI não têm preço público e precisam continuar no accrual — marcar o
 * título errado é pior do que não marcar.
 */

/** Famílias de título. O sufixo `_JS` indica cupom semestral. */
export const TREASURY_FAMILIES = {
    SELIC: 'SELIC',
    PRE: 'PRE',
    PRE_JS: 'PRE_JS',
    IPCA: 'IPCA',
    IPCA_JS: 'IPCA_JS',
    IGPM_JS: 'IGPM_JS',
    EDUCA: 'EDUCA',
    RENDA: 'RENDA',
};

/** Famílias que pagam cupom semestral (PU cai no dia do cupom). */
export const COUPON_FAMILIES = new Set([
    TREASURY_FAMILIES.PRE_JS,
    TREASURY_FAMILIES.IPCA_JS,
    TREASURY_FAMILIES.IGPM_JS,
]);

export const familyHasCoupon = (family) => COUPON_FAMILIES.has(family);

/** Motivos de recusa do casamento — diagnóstico legível na auditoria. */
export const MATCH_REJECTION = {
    NOT_TREASURY: 'NOT_TREASURY',       // CDB/LCI/LCA/poupança: sem preço público
    UNKNOWN_FAMILY: 'UNKNOWN_FAMILY',   // diz "Tesouro" mas não dá para saber qual
    NO_MATURITY: 'NO_MATURITY',         // sem vencimento nem ano no nome
    AMBIGUOUS: 'AMBIGUOUS',             // mais de um título da família no mesmo ano
    NO_SERIES: 'NO_SERIES',             // identificado, mas sem série de PU ingerida
    HAS_COUPON: 'HAS_COUPON',           // NTN-B/NTN-F: fica no accrual (ver model)
};

/** Maiúsculas sem acento — o usuário digita "PRÉ-FIXADO", "Pós", "IGP-M". */
const norm = (s) => String(s || '')
        .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();

/**
 * "Tipo Titulo" do CSV → família. São exatamente 8 rótulos no arquivo oficial;
 * um rótulo novo devolve `null` (o título é ignorado na ingestão em vez de virar
 * uma família inventada).
 */
export const classifyTreasuryLabel = (tipoTitulo) => {
    const t = norm(tipoTitulo);
    if (!t.includes('TESOURO')) return null;
    const js = t.includes('JUROS SEMESTRAIS');

    if (t.includes('EDUCA')) return TREASURY_FAMILIES.EDUCA;
    if (t.includes('RENDA+') || t.includes('RENDA +')) return TREASURY_FAMILIES.RENDA;
    if (t.includes('SELIC')) return TREASURY_FAMILIES.SELIC;
    if (t.includes('IGPM') || t.includes('IGP-M')) return js ? TREASURY_FAMILIES.IGPM_JS : null;
    if (t.includes('IPCA')) return js ? TREASURY_FAMILIES.IPCA_JS : TREASURY_FAMILIES.IPCA;
    if (t.includes('PREFIXADO')) return js ? TREASURY_FAMILIES.PRE_JS : TREASURY_FAMILIES.PRE;
    return null;
};

export const treasuryTitleKey = (family, maturityIso) => `${family}|${maturityIso}`;

export const parseTreasuryKey = (key) => {
    const [family, maturity] = String(key || '').split('|');
    return family && maturity ? { family, maturity } : null;
};

/** Data (Date|string) → `YYYY-MM-DD`, sem deixar o fuso puxar um dia para trás. */
const toIsoDay = (d) => {
    if (!d) return null;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
};

/**
 * Família a partir do texto livre que o usuário cadastrou (nome + ticker).
 * Aceita tanto o nome comercial atual ("Tesouro IPCA+ 2035") quanto o nome
 * técnico antigo, que ainda aparece em extrato de corretora (LTN, LFT, NTN-B).
 */
export const familyFromUserText = (text) => {
    const t = norm(text);

    // Nomes técnicos primeiro: "NTN-B Principal" é ZERO-cupom e "NTN-B" seco tem
    // cupom — a ordem entre os dois é o que distingue.
    if (/NTN-?B\s+PRINCIPAL/.test(t)) return TREASURY_FAMILIES.IPCA;
    if (/NTN-?B/.test(t)) return TREASURY_FAMILIES.IPCA_JS;
    if (/NTN-?F/.test(t)) return TREASURY_FAMILIES.PRE_JS;
    if (/\bLTN\b/.test(t)) return TREASURY_FAMILIES.PRE;
    if (/\bLFT\b/.test(t)) return TREASURY_FAMILIES.SELIC;

    const js = /JUROS SEMESTRAIS|SEMESTRAL|COM JUROS/.test(t);
    if (t.includes('EDUCA')) return TREASURY_FAMILIES.EDUCA;
    if (/RENDA\s*\+|RENDA MAIS|APOSENTADORIA/.test(t)) return TREASURY_FAMILIES.RENDA;
    if (t.includes('SELIC')) return TREASURY_FAMILIES.SELIC;
    if (/IGPM|IGP-M/.test(t)) return TREASURY_FAMILIES.IGPM_JS;
    if (t.includes('IPCA')) return js ? TREASURY_FAMILIES.IPCA_JS : TREASURY_FAMILIES.IPCA;
    if (/PREFIXADO|PRE-FIXADO|\bPRE\b/.test(t)) return js ? TREASURY_FAMILIES.PRE_JS : TREASURY_FAMILIES.PRE;
    return null;
};

/**
 * Posição do usuário → chave canônica do título, contra o catálogo de séries
 * disponíveis.
 *
 * Escada de identificação do vencimento:
 *  1. `maturityDate` batendo EXATO com uma série da família;
 *  2. `maturityDate` com o ano batendo, quando esse ano tem um único título da
 *     família (cobre vencimento digitado com o dia errado — 15/05 vs 15/08);
 *  3. ano extraído do nome ("Tesouro IPCA+ 2035"), também exigindo unicidade.
 *
 * Ambiguidade nunca é resolvida por chute: dois títulos candidatos → recusa.
 *
 * @param {Object} asset posição (`type`, `name`, `ticker`, `maturityDate`, `fixedIncomeIndex`)
 * @param {Iterable<string>} availableKeys chaves com série de PU ingerida
 * @returns {{ key: string|null, family: string|null, hasCoupon: boolean, reason: string|null }}
 */
export const resolveTreasuryTitleKey = (asset, availableKeys = []) => {
    const miss = (reason, family = null) => ({
        key: null,
        family,
        hasCoupon: family ? familyHasCoupon(family) : false,
        reason,
    });

    if (!asset || asset.type !== 'FIXED_INCOME') return miss(MATCH_REJECTION.NOT_TREASURY);

    const text = `${asset.name || ''} ${asset.ticker || ''}`;
    // Sem a palavra "Tesouro" (ou o nome técnico do título), é RF privada: CDB,
    // LCI, LCA, debênture. Não existe preço público — segue no accrual.
    const t = norm(text);
    const looksTreasury = t.includes('TESOURO') || /\b(LTN|LFT|NTN-?[BF])\b/.test(t);
    if (!looksTreasury) return miss(MATCH_REJECTION.NOT_TREASURY);

    const family = familyFromUserText(text);
    if (!family) return miss(MATCH_REJECTION.UNKNOWN_FAMILY);
    if (familyHasCoupon(family)) return miss(MATCH_REJECTION.HAS_COUPON, family);

    const candidates = [...availableKeys]
        .map(parseTreasuryKey)
        .filter((p) => p && p.family === family);
    if (candidates.length === 0) return miss(MATCH_REJECTION.NO_SERIES, family);

    const hit = (maturity) => ({ key: treasuryTitleKey(family, maturity), family, hasCoupon: false, reason: null });

    const maturityIso = toIsoDay(asset.maturityDate);
    if (maturityIso) {
        if (candidates.some((c) => c.maturity === maturityIso)) return hit(maturityIso);
        const sameYear = candidates.filter((c) => c.maturity.slice(0, 4) === maturityIso.slice(0, 4));
        if (sameYear.length === 1) return hit(sameYear[0].maturity);
        if (sameYear.length > 1) return miss(MATCH_REJECTION.AMBIGUOUS, family);
        return miss(MATCH_REJECTION.NO_SERIES, family);
    }

    // Sem vencimento cadastrado: o ano no nome é a única pista. Pega o MAIOR ano
    // citado — "Tesouro IPCA+ 2035" comprado em 2026 tem os dois números no texto
    // só quando a corretora carimba a data de compra junto.
    const years = (t.match(/\b20\d{2}\b/g) || []).map(Number);
    if (years.length === 0) return miss(MATCH_REJECTION.NO_MATURITY, family);
    const year = String(Math.max(...years));

    const sameYear = candidates.filter((c) => c.maturity.slice(0, 4) === year);
    if (sameYear.length === 1) return hit(sameYear[0].maturity);
    if (sameYear.length > 1) return miss(MATCH_REJECTION.AMBIGUOUS, family);
    return miss(MATCH_REJECTION.NO_SERIES, family);
};
