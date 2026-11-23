// Gravação do macro-sync no documento MACRO_INDICATORS (SystemConfig).
//
// Regra de ouro (CLAUDE.md, regra 13): fonte que falhou deixa o campo como
// estava. Cada bloco abaixo escreve só o que alguma fonte trouxe e tem o seu
// próprio carimbo de frescor — `lastUpdated` avança a cada run e, sozinho, daria
// cara de fresco a um valor que nenhuma fonte entregou.

// Gravação POR INDICADOR, e só do que alguma fonte trouxe. Indicador sem fonte
// mantém o valor do banco; `ratesStale` é o aviso. O congelado pelo guard é o
// último valor bom — regravar é idempotente.
const applyOfficialValues = (config, official) => {
    if (!official.selicIsFallback && official.selic > 0) {
        config.selic = official.selic;
        config.cdi = official.cdi;
        config.riskFree = official.selic;
    }
    if (!official.ipcaIsFallback && Number.isFinite(official.ipca)) {
        config.ipca = official.ipca;
    }
};

// Observabilidade: fonte efetiva de cada taxa e se houve fallback.
// `ratesUpdatedAt` só é carimbado quando a Selic veio fresca e autoritativa —
// nem fallback nem valor congelado pelo guard contam como fresco.
const applyOfficialFlags = (config, official) => {
    config.ratesStale = !!official.isFallback || !!official.selicFrozen;
    // A fonte da NTN-B é do bloco do Tesouro: sobrevive aqui para não sumir
    // num run em que o Tesouro não trouxe taxa nova.
    const priorNtnbSource = config.ratesSources?.ntnb ?? null;
    config.ratesSources = { ...(official.sources || { selic: null, ipca: null }), ntnb: priorNtnbSource };
    if (!official.isFallback && !official.selicFrozen) {
        config.ratesUpdatedAt = new Date();
    }
};

const applyOfficialRates = (config, official) => {
    if (!official) return;
    applyOfficialValues(config, official);
    applyOfficialFlags(config, official);
};

// Escrita por moeda, não em bloco: uma fonte que cobre só o dólar não pode
// arrastar o BTC junto, nem o inverso. `currenciesUpdatedAt` só é carimbado
// quando AS DUAS vieram frescas. Dólar que não é número finito (undefined, NaN,
// texto) conta como ausente: viraria `dollar` e multiplicador de patrimônio.
const applyCurrencies = (config, currencies) => {
    const usdOk = Number.isFinite(currencies.usd);
    if (usdOk) {
        config.dollar = currencies.usd;
        config.dollarChange = currencies.usdChange;
    }
    if (currencies.btc !== null) {
        config.btc = currencies.btc;
        config.btcChange = currencies.btcChange;
    }
    config.currenciesSources = { usd: currencies.usdSource, btc: currencies.btcSource };
    config.currenciesStale = !usdOk || currencies.btc === null;
    if (!config.currenciesStale) {
        config.currenciesUpdatedAt = new Date();
    }
};

// Escrita por ÍNDICE e com carimbo próprio, pelo mesmo motivo das moedas: índice
// que não veio preserva o valor anterior — e isso APARECE em `indicesStale`.
const applyGlobalIndices = (config, globalIndices) => {
    if (globalIndices) {
        if (globalIndices.ibov) {
            config.ibov = globalIndices.ibov.value;
            config.ibovChange = globalIndices.ibov.change;
        }
        if (globalIndices.spx) {
            config.spx = globalIndices.spx.value;
            config.spxChange = globalIndices.spx.change;
        }
    }
    config.indicesSources = {
        ibov: globalIndices?.ibov?.source || null,
        spx: globalIndices?.spx?.source || null,
    };
    config.indicesStale = !globalIndices?.ibov || !globalIndices?.spx;
    if (!config.indicesStale) {
        config.indicesUpdatedAt = new Date();
    }
};

// Retornos 12m: null/NaN = série insuficiente ou parada — o valor gravado fica,
// em vez de virar a taxa de hoje (CDI) ou um número de fábrica (S&P/Ibov).
const applyTwelveMonthReturns = (config, { cdiReturn12m, spxReturn12m, ibovReturn12m }) => {
    if (Number.isFinite(cdiReturn12m)) config.cdiReturn12m = cdiReturn12m;
    if (Number.isFinite(spxReturn12m)) config.spxReturn12m = spxReturn12m;
    if (Number.isFinite(ibovReturn12m)) config.ibovReturn12m = ibovReturn12m;
};

// NTN-B sem taxa (null/0) não grava: o `ntnbLong` real do banco fica.
const applyTreasury = (config, treasury) => {
    if (treasury && treasury.ntnbLong) {
        config.ntnbLong = treasury.ntnbLong;
        config.ratesSources = { ...(config.ratesSources || {}), ntnb: treasury.ntnbSource };
    }
};

/**
 * Aplica as leituras de um run do macro-sync ao documento, na ordem em que o
 * gravador monolítico as aplicava (taxas → moedas → índices → retornos →
 * Tesouro), e carimba `lastUpdated`. Não salva.
 */
export const applyMacroReadings = (config, readings) => {
    applyOfficialRates(config, readings.official);
    applyCurrencies(config, readings.currencies);
    applyGlobalIndices(config, readings.globalIndices);
    applyTwelveMonthReturns(config, readings);
    applyTreasury(config, readings.treasury);
    config.lastUpdated = new Date();
    return config;
};
