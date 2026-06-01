
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

/**
 * QUANTIDADE de ativos exige mais precisão que dinheiro: cripto vai até 8 casas
 * decimais (1 satoshi = 0.00000001 BTC). safeFloat arredonda a 4 casas e zera
 * 0.0000028 BTC, fazendo a carteira parecer vazia. Use estes helpers SEMPRE que
 * o número for uma quantidade de cotas/unidades (não valor monetário).
 */
export const QUANTITY_EPSILON = 1e-9; // abaixo disto a posição é considerada zerada

export const safeQuantity = (value) => {
    if (!value || isNaN(value)) return 0;
    return parseFloat(Number(value).toFixed(8));
};

export const addQty = (a, b) => safeQuantity(safeQuantity(a) + safeQuantity(b));
export const subQty = (a, b) => safeQuantity(safeQuantity(a) - safeQuantity(b));

/**
 * Valor monetário = quantidade (8 casas) × preço. Diferente de safeMult, NÃO
 * trunca a quantidade a 4 casas antes de multiplicar — preserva cripto.
 */
export const safeValue = (quantity, price) => {
    const q = safeQuantity(quantity);
    const p = safeFloat(price);
    if (!q || !p) return 0;
    return safeCurrency(q * p);
};

/**
 * Preço médio = custo ÷ quantidade (8 casas). Evita o div/0 que safeDiv causa ao
 * truncar quantidades de cripto a 4 casas (0.0000028 → 0).
 */
export const safePrice = (totalCost, quantity) => {
    const q = safeQuantity(quantity);
    if (!q) return 0;
    return safeFloat(safeFloat(totalCost) / q);
};

export const calculatePercent = (current, initial) => {
    if (initial === 0) return 0;
    const diff = safeSub(current, initial);
    return safeMult(safeDiv(diff, initial), 100);
};

// --- NOVAS FUNÇÕES FINANCEIRAS (V4) ---

/**
 * Calcula o retorno diário usando Modified Dietz adaptado para TWRR Diário.
 * @param {number} startEquity Patrimônio Inicial (V0)
 * @param {number} endEquity Patrimônio Final (V1)
 * @param {number} flow Fluxo de Caixa Líquido (Aportes - Resgates)
 */
export const calculateDailyDietz = (startEquity, endEquity, flow) => {
    // Se não havia patrimônio no início do dia, o fluxo (aporte) é a base de cálculo.
    // Assumimos que o aporte ocorreu no início do dia para capturar o rendimento do primeiro dia.
    if (startEquity <= 0.01) {
        if (flow > 0.01) {
            return (endEquity - flow) / flow;
        }
        return 0;
    }

    // Se houve resgate total (ou maior que o patrimônio inicial)
    // O rendimento foi gerado sobre o startEquity antes do resgate.
    if (startEquity + flow <= 0.01) {
        return (endEquity - startEquity - flow) / startEquity;
    }

    // Para TWRR diário com fluxos intradiários, usamos peso 0.5 (Modified Dietz padrão)
    // Isso permite capturar a rentabilidade intradiária do fluxo sem distorcer a cota.
    const numerator = endEquity - startEquity - flow;
    const denominator = startEquity + (0.5 * flow); 
    
    if (denominator <= 0.01) return 0;
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
