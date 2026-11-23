// Partes da detecção de divergência altista (`signalEngine.detectBullishDivergence`).
// Séries ordenadas do mais RECENTE para o mais antigo; `rsi[i]` é o RSI do dia i.

// Parâmetros da busca, com os padrões de sempre.
export function resolveDivergenceOpts(opts) {
    return {
        wing: opts.wing ?? 2,                   // pregões de cada lado p/ confirmar o pivô
        minSeparation: opts.minSeparation ?? 3, // distância mínima entre os dois fundos
        maxLookback: opts.maxLookback ?? 40,    // janela de busca de pivôs
        rsiZone: opts.rsiZone ?? 45,            // fundo recente precisa estar em zona fraca
        maxRecentAge: opts.maxRecentAge ?? 6,   // frescor: pivô recente precisa estar perto de hoje
    };
}

// Mínimo local: fecha abaixo dos `wing` pregões de cada lado.
function isPivotLow(closes, i, wing) {
    for (let k = 1; k <= wing; k++) {
        if (!(closes[i] < closes[i - k]) || !(closes[i] < closes[i + k])) return false;
    }
    return true;
}

// Pivôs de baixa dentro da janela de lookback (só onde já há RSI).
export function findPivotLows(closes, rsi, wing, maxLookback) {
    const pivots = [];
    const limit = Math.min(closes.length - wing, maxLookback);
    for (let i = wing; i < limit; i++) {
        if (rsi[i] == null) continue;
        if (isPivotLow(closes, i, wing)) pivots.push(i);
    }
    return pivots;
}

// Primeiro pivô mais antigo a pelo menos `minSeparation` pregões do recente.
function pickOlderPivot(pivots, recent, minSeparation) {
    for (let j = 1; j < pivots.length; j++) {
        if (pivots[j] - recent >= minSeparation) return pivots[j];
    }
    return null;
}

// Par de fundos com preço mais baixo e RSI mais alto, ou null.
export function evaluateDivergence(closes, rsi, pivots, o) {
    if (pivots.length < 2) return null;

    const recent = pivots[0];                       // menor índice = pivô mais recente
    if (recent > o.maxRecentAge) return null;       // pivô recente precisa ser fresco
    if (!(closes[0] > closes[recent])) return null; // preço já reagindo acima do fundo

    const older = pickOlderPivot(pivots, recent, o.minSeparation);
    if (older === null) return null;

    const priceLowerLow = closes[recent] < closes[older];
    const rsiHigherLow = rsi[recent] > rsi[older];
    if (!(priceLowerLow && rsiHigherLow && rsi[recent] < o.rsiZone)) return null;

    return {
        rsiAtLow: rsi[recent],
        priorRsiLow: rsi[older],
        priceLow: closes[recent],
        priorPriceLow: closes[older],
        barsBetween: older - recent,
    };
}
