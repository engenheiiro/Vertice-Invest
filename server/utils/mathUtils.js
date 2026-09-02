
/**
 * Utilitário para operações financeiras seguras em JavaScript.
 * Evita erros como 0.1 + 0.2 = 0.30000000000000004
 * Estratégia: Arredondamento seguro para 4 casas decimais em floats e 2 em moeda.
 */

export const safeFloat = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Number(numeric.toFixed(4));
};

export const safeCurrency = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round((numeric + Number.EPSILON) * 100) / 100;
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
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Number(numeric.toFixed(8));
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
    return percentOf(diff, initial);
};

/**
 * `parte ÷ todo` em PERCENTUAL, arredondado só no fim.
 *
 * Não use `safeDiv` para isto: ele arredonda a RAZÃO a 4 casas, e a razão de um
 * percentual pequeno mora bem abaixo disso. Uma variação de R$ 1,58 sobre R$ 22.148
 * dá 0,00007134 → arredondado vira 0,0001 → exibido como "0,01%" no lugar de
 * "0,007%": 40% de erro, e todo percentual do sistema quantizado em degraus de
 * 0,01. Dinheiro tem 2 casas; razão não tem casa nenhuma até virar percentual.
 */
export const percentOf = (part, whole) => {
    const w = Number(whole);
    if (!Number.isFinite(w) || w === 0) return 0;
    const p = Number(part);
    if (!Number.isFinite(p)) return 0;
    return safeFloat((p / w) * 100);
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
    const finiteOrZero = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    };
    const start = finiteOrZero(startEquity);
    const end = finiteOrZero(endEquity);
    const cashFlow = finiteOrZero(flow);
    const inc = finiteOrZero(income);

    // Se não havia patrimônio no início do dia, o fluxo (aporte) é a base de cálculo.
    // Assumimos que o aporte ocorreu no início do dia para capturar o rendimento do primeiro dia.
    if (start <= 0.01) {
        if (cashFlow > 0.01) {
            return (end + inc - cashFlow) / cashFlow;
        }
        return 0;
    }

    // Se houve resgate total (ou maior que o patrimônio inicial)
    // O rendimento foi gerado sobre o startEquity antes do resgate.
    if (start + cashFlow <= 0.01) {
        return (end + inc - start - cashFlow) / start;
    }

    // Para TWRR diário com fluxos intradiários, usamos peso 0.5 (Modified Dietz padrão)
    // Isso permite capturar a rentabilidade intradiária do fluxo sem distorcer a cota.
    const numerator = end + inc - start - cashFlow;
    const denominator = start + (0.5 * cashFlow);

    if (denominator <= 0.01) return 0;
    return numerator / denominator;
};

/**
 * Calcula o Desvio Padrão de uma série de retornos.
 */
export const calculateStdDev = (returns) => {
    if (!Array.isArray(returns)) return 0;
    const validReturns = returns.map(Number).filter(Number.isFinite);
    if (validReturns.length < 2) return 0;
    const mean = validReturns.reduce((a, b) => a + b, 0) / validReturns.length;
    const variance = validReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (validReturns.length - 1);
    return Math.sqrt(variance);
};

/**
 * Amostra MÍNIMA de retornos diários para o Sharpe ter algum significado.
 * Exportada para que os chamadores não redeclarem o próprio limiar: havia um
 * guard morto no walletController (`length >= 5`) que nunca decidia nada, porque
 * a função abaixo já devolvia 0 abaixo de 10 observações.
 */
export const MIN_SHARPE_OBSERVATIONS = 10;

/**
 * Calcula o Índice de Sharpe (Anualizado).
 * Sharpe = (Retorno Médio Carteira - Risk Free) / Volatilidade
 *
 * Pressupõe que cada observação cobre UM pregão — a anualização por √252 depende
 * disso. Quem monta a série a partir de snapshots deve garantir o espaçamento
 * (ver `utils/walletRisk.js`).
 *
 * @param {number[]} walletReturns Array de retornos diários (%)
 * @param {number} riskFreeRate Taxa livre de risco anual (%) (ex: 11.25)
 */
export const calculateSharpeRatio = (walletReturns, riskFreeRate) => {
    if (!Array.isArray(walletReturns)) return 0;
    const validReturns = walletReturns.map(Number).filter(Number.isFinite);
    const parsedRiskFree = Number(riskFreeRate);
    const safeRiskFree = Number.isFinite(parsedRiskFree) && parsedRiskFree > -100
        ? parsedRiskFree
        : 0;

    // Converte Risk Free anual para diário
    const riskFreeDaily = (Math.pow(1 + safeRiskFree / 100, 1 / 252) - 1) * 100;

    return calculateSharpeFromExcess(validReturns.map(r => r - riskFreeDaily));
};

/**
 * Sharpe anualizado a partir dos retornos EXCEDENTES (carteira − risk-free) já
 * calculados. Existe para o caso em que a taxa livre de risco VARIA ao longo da
 * série — o CDI muda de ano para ano, e descontar a taxa de hoje de um retorno
 * de 2022 mede um prêmio que nunca existiu. `calculateSharpeRatio` é o atalho
 * para taxa constante e delega aqui, então a fórmula vive num lugar só.
 *
 * O desvio padrão é o do EXCESSO (definição de livro). Com taxa constante isso é
 * idêntico ao desvio dos retornos brutos — subtrair uma constante não muda a
 * dispersão —, então o atalho acima não mudou de resultado.
 *
 * @param {number[]} excessReturns retornos excedentes diários (%)
 */
export const calculateSharpeFromExcess = (excessReturns) => {
    if (!Array.isArray(excessReturns)) return 0;
    const valid = excessReturns.map(Number).filter(Number.isFinite);
    if (valid.length < MIN_SHARPE_OBSERVATIONS) return 0;

    const avgExcessReturn = valid.reduce((a, b) => a + b, 0) / valid.length;
    const stdDev = calculateStdDev(valid);

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
    const parsedQuota = Number(baseSnapshot?.quotaPrice);
    const prevQuota = Number.isFinite(parsedQuota) && parsedQuota > 0 ? parsedQuota : 100;
    const prevEquity = Number(baseSnapshot?.totalEquity || 0);
    const equity = Number(liveEquity);
    const flow = Number(periodFlow || 0);

    if (![prevEquity, equity, flow].every(Number.isFinite) || equity < 0) return prevQuota;

    if (prevEquity <= 0 && flow <= 0) return prevQuota;

    const periodReturn = calculateDailyDietz(prevEquity, equity, flow);
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
