
/**
 * Utilitário para operações financeiras seguras em JavaScript.
 * Evita erros como 0.1 + 0.2 = 0.30000000000000004
 * Estratégia: Arredondamento seguro para 2 ou 4 casas decimais.
 */

export const safeFloat = (value) => {
    if (!value || isNaN(value)) return 0;
    return parseFloat(value.toFixed(4)); // Mantém precisão interna de 4 casas
};

export const safeCurrency = (value) => {
    if (!value || isNaN(value)) return 0;
    // Arredonda para 2 casas decimais corretamente
    return Math.round((value + Number.EPSILON) * 100) / 100;
};

export const safeAdd = (a, b) => {
    return safeFloat(safeFloat(a) + safeFloat(b));
};

export const safeSub = (a, b) => {
    return safeFloat(safeFloat(a) - safeFloat(b));
};

export const safeMult = (a, b) => {
    return safeFloat(safeFloat(a) * safeFloat(b));
};

export const safeDiv = (a, b) => {
    if (b === 0) return 0;
    return safeFloat(safeFloat(a) / safeFloat(b));
};

export const calculatePercent = (current, initial) => {
    if (initial === 0) return 0;
    const diff = safeSub(current, initial);
    return safeMult(safeDiv(diff, initial), 100);
};
