/**
 * Identidade persistida de uma série histórica.
 *
 * O ticker canônico da carteira não é suficiente para identificar a série no
 * provedor: `BTC` é simultaneamente a criptomoeda Bitcoin (`BTC-USD` no Yahoo)
 * e um ativo listado nos EUA. Namespacing pelo símbolo do provedor evita que o
 * worker de uma classe sobrescreva candles de outra.
 */
export const historyStorageKey = (ticker, type = 'INDEX') => {
    const clean = String(ticker || '').trim().toUpperCase().replace(/\.SA$/, '');
    const normalizedType = String(type || 'INDEX').trim().toUpperCase();
    if (!clean) return '';

    if (normalizedType === 'CRYPTO') {
        return clean.endsWith('-USD') ? clean : `${clean}-USD`;
    }

    return clean;
};
