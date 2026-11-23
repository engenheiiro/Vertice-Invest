// Regras puras do catálogo do Tesouro raspado do Investidor10.

const TITLE_MARKERS = ['Tesouro', 'IPCA', 'Prefixado', 'Selic', 'Renda+'];

/** Célula que nomeia um título: texto com mais de 5 letras e um marcador conhecido. */
export const looksLikeBondTitle = (text) =>
    text.length > 5 && TITLE_MARKERS.some((marker) => text.includes(marker));

/**
 * Tipo e indexador de um título. O nome manda; quando ele não revela o
 * indexador ("Tesouro Reserva 2036" é Selic), vale o índice DECLARADO na coluna
 * de rentabilidade — o default IPCA só sobra quando nenhuma das duas diz nada.
 */
export const classifyBond = (cleanTitle, declaredIndex) => {
    if (cleanTitle.includes('Prefixado') || cleanTitle.includes('LTN')) return { type: 'PREFIXADO', index: 'PRE' };
    if (cleanTitle.includes('Selic') || cleanTitle.includes('LFT')) return { type: 'SELIC', index: 'SELIC' };
    if (/Renda\+/i.test(cleanTitle)) return { type: 'RENDAMAIS', index: 'IPCA' };
    if (/Educa\+/i.test(cleanTitle)) return { type: 'EDUCA', index: 'IPCA' };
    if (declaredIndex === 'SELIC') return { type: 'SELIC', index: 'SELIC' };
    if (declaredIndex === 'PRE') return { type: 'PREFIXADO', index: 'PRE' };
    return { type: 'IPCA', index: 'IPCA' };
};

/**
 * NTN-B de referência para o benchmark: IPCA+ longo (venc. >= 2035), nunca
 * Educa+/Renda+. A taxa ainda passa pela faixa de yield real em quem chama.
 */
export const isReferenceNtnbTitle = (type, cleanTitle) =>
    type === 'IPCA' && /IPCA\+/i.test(cleanTitle) && !/Educa|Renda/i.test(cleanTitle)
    && /20(3[5-9]|[4-9]\d)/.test(cleanTitle);
