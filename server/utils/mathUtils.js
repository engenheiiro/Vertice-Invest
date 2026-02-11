
/**
 * Utilitário para operações financeiras seguras em JavaScript.
 * Evita erros como 0.1 + 0.2 = 0.30000000000000004
 * Estratégia: Arredondamento seguro para 4 casas decimais em floats e 2 em moeda.
 */

export const safeFloat = (value) => {
    if (!value || isNaN(value)) return 0;
    return parseFloat(value.toFixed(4));
};

export const safeCurrency = (value) => {
    if (!value || isNaN(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
};

export const safeAdd = (a, b) => safeFloat(safeFloat(a) + safeFloat(b));
export const safeSub = (a, b) => safeFloat(safeFloat(a) - safeFloat(b));
export const safeMult = (a, b) => safeFloat(safeFloat(a) * safeFloat(b));

export const safeDiv = (a, b) => {
    if (b === 0) return 0;
    return safeFloat(safeFloat(a) / safeFloat(b));
};

export const calculatePercent = (current, initial) => {
    if (initial === 0) return 0;
    const diff = safeSub(current, initial);
    return safeMult(safeDiv(diff, initial), 100);
};

// --- NOVAS FUNÇÕES FINANCEIRAS (V4) ---

/**
 * Calcula o retorno diário usando Modified Dietz (Simplificado para Janela de 1 Dia).
 * R = (V1 - V0 - F) / (V0 + F * weight)
 * @param {number} startEquity Patrimônio Inicial (V0)
 * @param {number} endEquity Patrimônio Final (V1)
 * @param {number} flow Fluxo de Caixa Líquido (Aportes - Resgates)
 * @param {number} weight Peso do fluxo (padrão 0.5 para fluxo no meio do dia)
 */
export const calculateDailyDietz = (startEquity, endEquity, flow, weight = 0.5) => {
    const numerator = endEquity - startEquity - flow;
    const denominator = startEquity + (flow * weight);
    
    if (denominator <= 0.01) return 0; // Evita divisão por zero ou negativa absurda
    return numerator / denominator;
};

/**
 * Calcula o Desvio Padrão de uma série de retornos.
 */
export const calculateStdDev = (returns) => {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance);
};

/**
 * Calcula o Índice de Sharpe (Anualizado).
 * Sharpe = (Retorno Médio Carteira - Risk Free) / Volatilidade
 * @param {number[]} walletReturns Array de retornos diários (%)
 * @param {number} riskFreeRate Taxa livre de risco anual (%) (ex: 11.25)
 */
export const calculateSharpeRatio = (walletReturns, riskFreeRate) => {
    if (walletReturns.length < 10) return 0;
    
    // Converte Risk Free anual para diário
    const riskFreeDaily = (Math.pow(1 + riskFreeRate / 100, 1 / 252) - 1) * 100;
    
    const excessReturns = walletReturns.map(r => r - riskFreeDaily);
    const avgExcessReturn = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
    const stdDev = calculateStdDev(walletReturns);
    
    if (stdDev === 0) return 0;
    
    // Anualiza o Sharpe (Multiplica por raiz de 252)
    return (avgExcessReturn / stdDev) * Math.sqrt(252);
};

/**
 * Calcula o Beta da carteira em relação ao Benchmark.
 * Beta = Covariância(R_carteira, R_mercado) / Variância(R_mercado)
 */
export const calculateBeta = (walletReturns, marketReturns) => {
    const minLen = Math.min(walletReturns.length, marketReturns.length);
    if (minLen < 10) return 1; // Beta neutro por falta de dados

    const w = walletReturns.slice(-minLen);
    const m = marketReturns.slice(-minLen);

    const avgW = w.reduce((a, b) => a + b, 0) / minLen;
    const avgM = m.reduce((a, b) => a + b, 0) / minLen;

    let covariance = 0;
    let varianceM = 0;

    for (let i = 0; i < minLen; i++) {
        covariance += (w[i] - avgW) * (m[i] - avgM);
        varianceM += Math.pow(m[i] - avgM, 2);
    }

    if (varianceM === 0) return 1;
    return covariance / varianceM;
};
