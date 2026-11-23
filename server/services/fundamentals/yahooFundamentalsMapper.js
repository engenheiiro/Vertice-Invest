import { safeFloat } from '../../utils/mathUtils.js';

// Mapeamento puro quoteSummary do Yahoo → fundamentos do MarketAsset.
// Regra de ouro (regra 13): campo que a fonte não trouxe sai `null`, nunca 0 nem
// número de outro campo. Cada leitura abaixo explica o atalho que já foi defeito.

// Primeiro valor truthy, ou null — equivale a `a || b || null`. Só para texto.
const firstTruthy = (...values) => values.find(Boolean) ?? null;

// Leitor ÚNICO de número do Yahoo: número finito ou `{ raw: finito }`; texto,
// objeto sem raw, NaN e ±Infinity → null. Antes cada campo lia do seu jeito, e
// o teste truthy gravava `'47.49'`, `{ raw }` cru e Infinity como dado.
function num(value) {
    const n = value !== null && typeof value === 'object' ? value.raw : value;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// Primeiro número lido diferente de 0 — para campos em que o 0 do Yahoo é
// marcador de ausência (beta/P/VP/VPA/volume/preço), com fallback de módulo.
const firstNonZero = (...values) => values.map(num).find(v => v !== null && v !== 0) ?? null;

// Fração → percentual; ausente → null, mas 0 é dado (ROE real de 0 é 0).
// safeFloat corta o ruído binário do *100 (0.0845*100 = 8.450000000000001).
function pctOrNull(value) {
    const n = num(value);
    return n === null ? null : safeFloat(n * 100);
}

// P/L é o TRAILING, e só ele. O fallback para `forwardPE` misturava estimativa
// de analista com lucro realizado na mesma coluna: empresa com prejuízo nos
// últimos 12 meses (sem trailingPE) aparecia com o P/L projetado como se fosse
// o histórico, e o Graham/PEG a tratavam como lucrativa. Sem trailing → null.
function trailingPe(sd) {
    return firstNonZero(sd.trailingPE);
}

// DY ciente de fundo: ETFs/REITs frequentemente NÃO expõem `summaryDetail.dividendYield`
// (campo de ação) — o yield do fundo vem em `yield` ou `trailingAnnualDividendYield`.
// Number.isFinite descarta null/undefined E NaN — um NaN aqui quebrava o cast
// Mongoose do `dy` (abortava todo o sync).
//
// `null` quando NENHUM dos campos veio: resposta parcial do Yahoo (módulo
// `summaryDetail` ausente) não é "não paga dividendo". O `0` antigo gravava
// dy=0 por cima de um yield real toda vez que o módulo faltava. Não-pagador de
// verdade vem com `trailingAnnualDividendYield: 0`, que é finito e passa.
// DY negativo não existe: é resposta corrompida, e sai null em vez de dado.
function dividendYield(sd) {
    const dyRaw = [sd.dividendYield, sd.yield, sd.trailingAnnualDividendYield].map(num).find(v => v !== null);
    return dyRaw != null && dyRaw >= 0 ? safeFloat(dyRaw * 100) : null;
}

// Valor de mercado é o do equity. `enterpriseValue` (equity + dívida − caixa)
// NÃO é substituto: em empresa alavancada a diferença é de vezes, e o número
// caía no gate de porte e no ranking como se fosse market cap. Sem dado → null.
function equityMarketCap(sd) {
    const marketCap = num(sd.marketCap);
    return marketCap > 0 ? marketCap : null;
}

// Liquidez em VALOR financeiro (US$/dia), não em nº de ações — alinha com a
// liquidez dos ativos BR (Liq.2meses, em R$) que o scoringEngine compara contra
// o piso de 1M. Sem isso, ações caras de baixo giro de papéis (AZO ~$3000,
// <1M ações/dia mas >$2bi/dia em valor) levavam -30 de confiança indevidamente.
// Volume ou preço negativo não existe; liquidez só sai positiva e finita.
function tradedValue(sd, ks, lastPrice) {
    const avgVolumeShares = firstNonZero(sd.averageVolume, ks.averageDailyVolume10Day);
    if (!(avgVolumeShares > 0 && lastPrice > 0)) return null;
    const value = avgVolumeShares * lastPrice;
    return Number.isFinite(value) ? value : null;
}

// Yahoo Finance retorna debtToEquity em formato percentual (ex: 47.49 = 47.49% = ratio 0.4749)
function debtToEquityRatio(fd) {
    const percent = num(fd.debtToEquity);
    return percent !== null ? percent / 100 : null;
}

// PEG ratio: P/E ÷ earnings growth (só com crescimento positivo).
function pegRatio(pl, earningsGrowth) {
    return (pl && earningsGrowth && earningsGrowth > 0) ? pl / earningsGrowth : null;
}

export function extractFundamentals(ticker, data) {
    const sd = data.summaryDetail || {};
    const ks = data.defaultKeyStatistics || {};
    const fd = data.financialData || {};
    const ap = data.assetProfile || {};
    const pr = data.price || {};

    const pl = trailingPe(sd);
    const earningsGrowth = pctOrNull(fd.earningsGrowth);
    const lastPrice = firstNonZero(fd.currentPrice, sd.regularMarketPrice);

    return {
        pl,
        pvp: firstNonZero(ks.priceToBook),
        dy: dividendYield(sd),
        beta: firstNonZero(ks.beta, sd.beta),
        marketCap: equityMarketCap(sd),
        roe: pctOrNull(fd.returnOnEquity),
        netMargin: pctOrNull(fd.profitMargins),
        revenueGrowth: pctOrNull(fd.revenueGrowth),
        earningsGrowth,
        debtToEquity: debtToEquityRatio(fd),
        avgLiquidity: tradedValue(sd, ks, lastPrice),
        lastPrice,
        payoutRatio: pctOrNull(sd.payoutRatio),
        vpa: firstNonZero(ks.bookValue),
        // Só o lucro REALIZADO (trailing). O forwardEps é projeção de analista: no
        // Graham (√22,5 × LPA × VPA) ele virava preço justo de um lucro que não houve.
        lpa: num(ks.trailingEps),
        sector: firstTruthy(ap.sector),
        industry: firstTruthy(ap.industry),
        // Nome da empresa vem do módulo `price` (longName/shortName). NUNCA usar
        // companyOfficers — isso retornava o nome do CEO (ex.: "Mr. Timothy D. Cook").
        name: firstTruthy(pr.longName, pr.shortName),
        peg: pegRatio(pl, earningsGrowth),
    };
}

// Campos do $set de fundamentos: [destino no MarketAsset, campo extraído, regra].
// 'present' grava quando não é null (0 é dado); 'truthy' exige valor (0 = sem dado).
const PAYLOAD_FIELDS = [
    ['pl', 'pl', 'present'],
    ['pvp', 'pvp', 'present'],
    ['dy', 'dy', 'present'],
    ['beta', 'beta', 'present'],
    ['marketCap', 'marketCap', 'truthy'],
    ['roe', 'roe', 'present'],
    ['netMargin', 'netMargin', 'present'],
    ['revenueGrowth', 'revenueGrowth', 'present'],
    ['earningsGrowth', 'earningsGrowth', 'present'],
    ['debtToEquity', 'debtToEquity', 'present'],
    ['liquidity', 'avgLiquidity', 'truthy'],
    ['payout', 'payoutRatio', 'present'],
    ['vpa', 'vpa', 'present'],
    ['lpa', 'lpa', 'present'],
    ['peg', 'peg', 'present'],
];

// Copia para `payload` só o que a fonte trouxe — campo ausente fica fora do $set
// e preserva o valor já gravado.
export function assignKnownFundamentals(payload, fundamentals) {
    for (const [target, source, rule] of PAYLOAD_FIELDS) {
        const value = fundamentals[source];
        if (rule === 'truthy' ? value : value !== null) payload[target] = value;
    }
    return payload;
}
