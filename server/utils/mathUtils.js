
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
 * @param {number} [income=0] Proventos (dividendos/JCP) com ex-date no dia — RENDA,
 *   não fluxo. Compensa a queda de preço do dia-ex; sem ele a cota vaza proventos.
 */
export const calculateDailyDietz = (startEquity, endEquity, flow, income = 0) => {
    // `income` = proventos com EX-DATE no dia. São RETORNO, não fluxo de caixa:
    // no dia-ex o preço cai (endEquity menor), mas o provento recebido compensa
    // essa queda. Sem creditá-lo, a cota (TWRR) contabiliza a queda como prejuízo
    // PERMANENTE — o "vazamento de proventos" que fazia uma carteira de FIIs
    // (~1%/mês distribuído) parecer plana ou perdendo do CDI.
    const inc = Number(income) || 0;

    // Se não havia patrimônio no início do dia, o fluxo (aporte) é a base de cálculo.
    // Assumimos que o aporte ocorreu no início do dia para capturar o rendimento do primeiro dia.
    if (startEquity <= 0.01) {
        if (flow > 0.01) {
            return (endEquity + inc - flow) / flow;
        }
        return 0;
    }

    // Se houve resgate total (ou maior que o patrimônio inicial)
    // O rendimento foi gerado sobre o startEquity antes do resgate.
    if (startEquity + flow <= 0.01) {
        return (endEquity + inc - startEquity - flow) / startEquity;
    }

    // Para TWRR diário com fluxos intradiários, usamos peso 0.5 (Modified Dietz padrão)
    // Isso permite capturar a rentabilidade intradiária do fluxo sem distorcer a cota.
    const numerator = endEquity + inc - startEquity - flow;
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
 * Seleciona o snapshot-âncora para o cálculo de cota "live" (TWRR).
 *
 * Regra ÚNICA usada pelo KPI (getWalletData) e pelo gráfico (getWalletPerformance)
 * para que ambos partam do MESMO ponto e produzam o mesmo TWRR no ponto live.
 * Caminha do mais recente para o mais antigo; pula um snapshot "resetado"
 * (quota ~100) APENAS se existir histórico mais antigo com cota válida (>1 de 100).
 *
 * @param {Array} snapshotsDesc snapshots ordenados do MAIS RECENTE para o mais antigo
 */
export const selectAnchorSnapshot = (snapshotsDesc) => {
    if (!Array.isArray(snapshotsDesc) || snapshotsDesc.length === 0) return null;
    if (snapshotsDesc.length === 1) return snapshotsDesc[0];

    for (let i = 0; i < snapshotsDesc.length; i++) {
        const snap = snapshotsDesc[i];
        const isReset = Math.abs((snap.quotaPrice || 100) - 100) < 0.1;
        if (isReset) {
            const hasValidHistory = snapshotsDesc
                .slice(i + 1)
                .some((old) => Math.abs((old.quotaPrice || 100) - 100) > 1);
            if (hasValidHistory) continue; // pula snapshot corrompido
        }
        return snap;
    }
    return snapshotsDesc[0];
};

/**
 * Calcula a cota (TWRR) "live" a partir de um snapshot-âncora, o patrimônio
 * atual e o fluxo de caixa do período (aportes − resgates). Fonte ÚNICA da
 * verdade: KPI e gráfico chamam esta função com o MESMO âncora/fluxo, então o
 * último ponto do gráfico passa a ser idêntico ao TWRR do KPI.
 *
 * @param {Object|null} baseSnapshot âncora com { quotaPrice, totalEquity }
 * @param {number} liveEquity patrimônio atual (V1)
 * @param {number} periodFlow fluxo líquido desde o âncora (BUY − SELL)
 */
export const computeLiveQuota = (baseSnapshot, liveEquity, periodFlow) => {
    const prevQuota = baseSnapshot && baseSnapshot.quotaPrice ? baseSnapshot.quotaPrice : 100;
    const prevEquity = baseSnapshot ? (baseSnapshot.totalEquity || 0) : 0;
    const flow = periodFlow || 0;

    if (prevEquity <= 0 && flow <= 0) return prevQuota;

    const periodReturn = calculateDailyDietz(prevEquity, liveEquity, flow);
    // Circuit breaker: ignora variações absurdas (dados ruins) mantendo a cota.
    if (periodReturn > -0.8 && periodReturn < 1.0) {
        return prevQuota * (1 + periodReturn);
    }
    return prevQuota;
};

/**
 * Passo de um benchmark "cashflow-aware": o valor anterior cresce pelo fator do
 * período e recebe o fluxo de caixa (aporte/resgate) do período. Permite comparar
 * o índice (CDI/IPCA/Ibov) com a carteira real, que também recebe os aportes.
 */
export const benchmarkStep = (prevValue, periodFactor, flow) => {
    return safeCurrency((prevValue || 0) * (periodFactor || 1) + (flow || 0));
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
