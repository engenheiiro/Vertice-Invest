/**
 * Avaliação de ativos de renda fixa / caixa (CASH, FIXED_INCOME).
 *
 * Fonte ÚNICA do cálculo de rendimento usada pelos caminhos "live" (KPI em
 * getWalletData e o ponto live de getWalletPerformance via calculateLiveKPIS),
 * para que ambos produzam EXATAMENTE o mesmo patrimônio. Antes, calculateLiveKPIS
 * ignorava o rendimento (tratava o valor como nominal), divergindo do KPI.
 *
 * Convenção de datas: tudo ancorado no fuso de São Paulo (a B3 e o CDI operam
 * em dias úteis BR), evitando que o relógio UTC do servidor "ande" um dia.
 *
 * Duas formas de precificar convivem aqui, e `valueFixedIncomeAsset` é a porta
 * única que escolhe entre elas:
 *  - ACCRUAL ("na curva"): compõe a taxa contratada dia a dia. É o valor de quem
 *    leva ao vencimento, e a única opção para RF privada (CDB/LCI/LCA), que não
 *    tem preço público.
 *  - MTM (marcado a mercado): o que a posição vale se vendida HOJE, pela série de
 *    PU oficial do Tesouro Direto. Só para título público identificado sem
 *    ambiguidade e sem cupom semestral.
 */
import { countBusinessDays, isBusinessDay, toDateKey } from './dateUtils.js';

/** "Hoje" no fuso de São Paulo, como Date à meia-noite UTC (dia puro). */
export const brazilToday = () => {
    const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    return new Date(s + 'T00:00:00.000Z');
};

/**
 * Converte uma data qualquer para o "dia" no fuso de São Paulo (Date à meia-noite
 * UTC). Datas "puras" (já à meia-noite UTC, vindas de input YYYY-MM-DD) não levam
 * shift de fuso — evita retroceder um dia.
 */
export const brazilDateOnly = (d) => {
    const dateObj = new Date(d);
    let s;
    if (dateObj.getUTCHours() === 0 && dateObj.getUTCMinutes() === 0 && dateObj.getUTCSeconds() === 0) {
        s = dateObj.toISOString().split('T')[0];
    } else {
        s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(dateObj);
    }
    return new Date(s + 'T00:00:00.000Z');
};

/**
 * Fator diário de rendimento. Taxa > 50 é tratada como % do CDI (ex.: 100 = 100%
 * do CDI); taxa <= 50 como prefixada a.a. (ex.: 12 = 12% a.a.). Alinhado com o
 * rebuild (financialService) e com getWalletData.
 */
export const fixedIncomeDailyFactor = (fixedIncomeRate, cdiRate) => {
    const rawRate = fixedIncomeRate > 0 ? fixedIncomeRate : 100;
    const selicDailyFactor = Math.pow(1 + (cdiRate / 100), 1 / 252);
    if (rawRate > 50) {
        return ((selicDailyFactor - 1) * (rawRate / 100)) + 1;
    }
    return Math.pow(1 + (rawRate / 100), 1 / 252);
};

/**
 * Taxa anual efetiva (% a.a.) de um título pós-fixado/indexado, somando o índice
 * vivo ao spread contratado. Ex.: Tesouro Selic "SELIC + 0,08%" → selic + 0.0843.
 *
 * Retorna `null` quando o ativo não declara índice (PRE/manual): nesse caso o
 * `fixedIncomeRate` já é a taxa cheia e o caminho legado (prefixado/%CDI) vale.
 * SELIC é aproximada por `cdi + 0.10` quando não informada (CDI ≈ SELIC − 0,10).
 */
export const effectiveAnnualRate = (asset, { cdiRate = 0, selic, ipca } = {}) => {
    const idx = (asset?.fixedIncomeIndex || '').toUpperCase();
    if (!idx) return null;
    const spread = Number(asset.fixedIncomeSpread) || 0;
    const cdi = Number(cdiRate) || 0;
    const selicRate = (selic != null && selic > 0) ? Number(selic) : cdi + 0.10;
    const ipcaRate = (ipca != null && ipca > 0) ? Number(ipca) : 0;
    if (idx === 'SELIC') return selicRate + spread;
    if (idx === 'CDI') return cdi + spread;
    if (idx === 'IPCA') return ipcaRate + spread;
    return null; // PRE/PREFIXADO e desconhecidos caem no caminho legado
};

/**
 * Fator diário ciente do índice. Se o ativo tem índice (SELIC/CDI/IPCA), compõe
 * a taxa efetiva (índice vivo + spread); senão usa o caminho legado por
 * `fixedIncomeRate` (>50 = %CDI, ≤50 = prefixado a.a.). Garante que Tesouro
 * Selic renda SELIC+spread em vez de só o spread como prefixado.
 */
export const assetDailyFactor = (asset, macro = {}) => {
    const eff = effectiveAnnualRate(asset, macro);
    if (eff !== null) return Math.pow(1 + (eff / 100), 1 / 252);
    return fixedIncomeDailyFactor(asset?.fixedIncomeRate, macro.cdiRate);
};

/**
 * Data de vencimento do título como "dia" no fuso SP (Date à meia-noite UTC), ou
 * `null` quando não há vencimento (CASH/reserva e RF perpétua nunca vencem).
 */
export const maturityDateOnly = (asset) => {
    if (!asset?.maturityDate) return null;
    const d = new Date(asset.maturityDate);
    if (isNaN(d.getTime())) return null;
    return brazilDateOnly(d);
};

/**
 * O título já venceu em relação à data de cálculo? No vencimento (`>=`) o título
 * PARA de render e é marcado VENCIDO — resgate é sugerido, nunca automático.
 */
export const isMatured = (asset, calcDate) => {
    const maturity = maturityDateOnly(asset);
    if (!maturity) return false;
    const ref = calcDate ? brazilDateOnly(calcDate) : brazilToday();
    return ref.getTime() >= maturity.getTime();
};

/**
 * Valor acumulado de um ativo CASH/FIXED_INCOME numa data, compondo CADA lote
 * desde sua data de compra pelos dias úteis (réplica exata da lógica de
 * getWalletData, agora compartilhada). Lote comprado HOJE rende 0 (dias úteis = 0).
 *
 * Vencimento: Tesouro/RF é resgatado ao par na data de vencimento e não rende
 * depois. Quando `asset.maturityDate` já passou, o accrual é CONGELADO no
 * vencimento (cap da data-fim), sem liquidar a posição — o valor exibido é o do
 * dia do vencimento até o usuário resgatar manualmente.
 *
 * @param {Object} asset { type, taxLots?, quantity, totalCost, fixedIncomeRate, startDate?, createdAt?, maturityDate? }
 * @param {Object} opts  { cdiRate, calcDate }
 * @returns {number} valor acumulado (na moeda do ativo; multiplicador cambial é aplicado pelo chamador)
 */
export const accrueFixedIncomeValue = (asset, { cdiRate, selic, ipca, calcDate, cdiCurve = null }) => {
    const isCash = asset.type === 'CASH';

    // Congela o accrual no vencimento: data-fim = min(calcDate, vencimento).
    const maturity = maturityDateOnly(asset);
    const endDate = (maturity && brazilDateOnly(calcDate).getTime() > maturity.getTime())
        ? maturity
        : calcDate;

    const lots = (asset.taxLots && asset.taxLots.length > 0)
        ? asset.taxLots
        : [{
            date: asset.startDate || asset.createdAt || new Date(),
            quantity: asset.quantity,
            price: asset.quantity > 0 ? asset.totalCost / asset.quantity : 0,
        }];

    return accrueLotsValue(
        lots.map((lot) => ({
            date: lot.date,
            principal: isCash ? lot.quantity : lot.quantity * lot.price,
        })),
        asset,
        { cdiRate, selic, ipca, endDate, cdiCurve },
    );
};

/**
 * Núcleo do accrual: compõe cada lote da compra (EXCLUSIVE) até a data-fim
 * (inclusive), dia útil a dia útil.
 *
 * Fonte ÚNICA usada pelos três caminhos que precisam do valor na curva — KPI ao
 * vivo, snapshot diário e rebuild do histórico. Antes o rebuild tinha a própria
 * cópia, e duas cópias da mesma conta divergiram de dois jeitos: aplicavam o
 * fator no PRÓPRIO dia da compra (um dia útil de juros a mais em toda a série) e
 * liam o CDI de fontes diferentes (curva histórica × taxa de hoje).
 *
 * Com `cdiCurve`, cada dia rende pela taxa que estava vigente NAQUELE dia. Sem
 * ela, a taxa corrente vale para todo o período — o comportamento anterior.
 *
 * @param {Array<{date: Date|string, principal: number}>} lots
 * @param {Object} spec { fixedIncomeIndex, fixedIncomeSpread, fixedIncomeRate }
 */
export const accrueLotsValue = (lots, spec, { cdiRate, selic, ipca, endDate, cdiCurve = null }) => {
    const end = brazilDateOnly(endDate);
    // Spread SELIC−CDI observado hoje, aplicado aos dias históricos. Usar a Selic
    // corrente num dia de 2024 seria pior que derivá-la do CDI daquele dia; o
    // fallback 0,10 é a mesma folga que `effectiveAnnualRate` já assume.
    const selicGap = (Number(selic) > 0 && Number(cdiRate) > 0)
        ? Number(selic) - Number(cdiRate)
        : 0.10;

    // A curva tem poucas taxas distintas (uma por regime da Selic): memoizar o
    // fator por taxa evita repetir a potenciação a cada dia útil percorrido.
    const factorByRate = new Map();
    const factorFor = (rate) => {
        let f = factorByRate.get(rate);
        if (f === undefined) {
            f = assetDailyFactor(spec, { cdiRate: rate, selic: rate + selicGap, ipca });
            factorByRate.set(rate, f);
        }
        return f;
    };

    let value = 0;
    for (const lot of lots) {
        const start = brazilDateOnly(lot.date);
        const principal = Number(lot.principal) || 0;
        if (principal === 0) continue;

        let compoundFactor;
        if (cdiCurve) {
            compoundFactor = 1;
            const cursor = new Date(start);
            while (cursor < end) {
                cursor.setUTCDate(cursor.getUTCDate() + 1);
                if (!isBusinessDay(cursor)) continue;
                const dayKey = toDateKey(cursor);
                const rateOfDay = cdiCurve.annualRateFor(dayKey);
                compoundFactor *= factorFor(Number.isFinite(rateOfDay) ? rateOfDay : cdiRate);
            }
        } else {
            compoundFactor = Math.pow(factorFor(cdiRate), countBusinessDays(start, end));
        }

        // Fator < 1 é dado corrompido (taxa negativa, data invertida): a posição
        // fica no principal em vez de encolher sozinha.
        if (!isFinite(compoundFactor) || compoundFactor < 1) compoundFactor = 1;
        value += principal * compoundFactor;
    }
    return value;
};

// --- MARCAÇÃO A MERCADO (título público) --------------------------------------

/**
 * Defasagem máxima aceita entre a data pedida e a Data Base encontrada.
 *
 * A série é publicada em dia útil, então feriado prolongado abre buracos de até
 * ~5 dias corridos. Além de 10 a série está quebrada (fonte fora do ar, título
 * removido) e a posição volta para o accrual em vez de ser marcada por um preço
 * velho — preço velho não é "quase certo", é um retorno inventado no dia em que
 * a série voltar.
 */
export const MAX_PU_STALE_DAYS = 10;

/** Razão de PU fora desta faixa não é preço, é dado corrompido. */
const MIN_PU_RATIO = 0.1;
const MAX_PU_RATIO = 10;

const isoDay = (d) => toDateKey(brazilDateOnly(d));

const daysBetweenIso = (fromIso, toIso) =>
    Math.round((Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`)) / 86400000);

/**
 * Último ponto da série com Data Base <= `targetIso`, ou `null` se não houver
 * nenhum (posição anterior ao início da série) ou se o encontrado estiver velho
 * demais. Busca binária: a série tem milhares de pontos e é consultada por lote,
 * por ativo, por dia de rebuild.
 *
 * @param {Array<{date: string, pu: number, puBuy: number|null}>} history ASC por data
 * @returns {{ point: Object, index: number }|null}
 */
export const findTreasuryPu = (history, targetIso, { maxStaleDays = MAX_PU_STALE_DAYS } = {}) => {
    if (!Array.isArray(history) || history.length === 0 || !targetIso) return null;

    let lo = 0;
    let hi = history.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (history[mid].date <= targetIso) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (found < 0) return null;

    const point = history[found];
    if (!(point.pu > 0)) return null;
    if (daysBetweenIso(point.date, targetIso) > maxStaleDays) return null;
    return { point, index: found };
};

/**
 * Lotes de um ativo no formato normalizado `{ dateIso, cost }`. CASH nunca chega
 * aqui marcado, mas a normalização respeita a mesma convenção do accrual
 * (quantidade é o próprio valor em caixa).
 */
export const normalizeLots = (asset) => {
    const isCash = asset.type === 'CASH';
    const lots = (asset.taxLots && asset.taxLots.length > 0)
        ? asset.taxLots
        : [{
            date: asset.startDate || asset.createdAt || new Date(),
            quantity: asset.quantity,
            price: asset.quantity > 0 ? asset.totalCost / asset.quantity : 0,
        }];
    return lots.map((lot) => ({
        dateIso: isoDay(lot.date),
        cost: isCash ? lot.quantity : lot.quantity * lot.price,
    }));
};

/**
 * Valor de mercado de lotes normalizados numa data. `null` = não marcável (o
 * chamador cai no accrual).
 *
 * Marca por RAZÃO DE PU sobre o custo de cada lote, e não por quantidade × PU de
 * mercado. Isso é deliberado: `quantity`/`price` da posição não seguem convenção
 * confiável (há posição real de Tesouro IPCA+ 2032 cadastrada como 2 × R$87,86,
 * quando o PU do título passa de R$3.000). Multiplicar quantidade por PU
 * multiplicaria o patrimônio do usuário por dezenas; a razão de PU é invariante a
 * como quantidade e preço foram digitados, porque só usa o custo e a VARIAÇÃO
 * percentual oficial do título.
 *
 * Âncora do lote: PU de COMPRA do dia da compra (o que o investidor paga), com
 * fallback no PU de venda quando a fonte não publicou um valor plausível. Marcar
 * o numerador pelo PU de venda e o denominador pelo de compra faz o spread de
 * recompra aparecer como a pequena perda imediata que ele é de verdade — é o que
 * o extrato do Tesouro Direto mostra.
 *
 * Fail-closed: qualquer lote sem PU utilizável derruba a marcação do ativo
 * INTEIRO. Marcar metade dos lotes e acumular a outra metade misturaria duas
 * réguas no mesmo número.
 */
/**
 * Quantidade IMPLÍCITA de títulos: Σ (custo do lote ÷ PU de compra do lote).
 *
 * É a mesma conta que a marcação já faz por dentro — `valor = Σ custo × PU_hoje
 * ÷ PU_compra` é idêntico a `PU_hoje × Σ (custo ÷ PU_compra)` — só que isolada,
 * para a UI poder exibir o PU do título em vez do preço unitário que o usuário
 * digitou.
 *
 * Isso resolve uma incoerência de tela: `quantity`/`price` da posição não seguem
 * convenção (o cadastro manual pede só o valor investido e grava quantidade 1; o
 * extrato da B3 traz a fração real e o PU), então o mesmo título aparecia com
 * "preço médio" R$ 735,92 numa carteira e R$ 2.943,68 na outra. A fração
 * implícita não depende de como foi digitado — só do custo e do PU oficial.
 *
 * `null` com a mesma regra fail-closed da marcação: um lote sem PU utilizável
 * invalida a quantidade do ativo inteiro.
 */
export const impliedTreasuryUnits = (lots, history) => {
    let units = 0;
    for (const lot of lots) {
        const anchor = findTreasuryPu(history, lot.dateIso);
        if (!anchor) return null;

        const anchorPu = anchor.point.puBuy > 0 ? anchor.point.puBuy : anchor.point.pu;
        if (!(anchorPu > 0)) return null;

        units += lot.cost / anchorPu;
    }
    return units > 0 ? units : null;
};

export const markLotsToMarket = (lots, history, targetIso) => {
    const current = findTreasuryPu(history, targetIso);
    if (!current) return null;

    let value = 0;
    for (const lot of lots) {
        const anchor = findTreasuryPu(history, lot.dateIso);
        if (!anchor) return null;

        const anchorPu = anchor.point.puBuy > 0 ? anchor.point.puBuy : anchor.point.pu;
        if (!(anchorPu > 0)) return null;

        const ratio = current.point.pu / anchorPu;
        if (!isFinite(ratio) || ratio < MIN_PU_RATIO || ratio > MAX_PU_RATIO) return null;

        value += lot.cost * ratio;
    }
    return value;
};

/**
 * Valor de mercado da posição, ou `null` quando não dá para marcar. Devolve
 * também o valor no pregão anterior, que é o que dá a variação do dia.
 *
 * @returns {{ value: number, previousValue: number|null, priceDate: string }|null}
 */
export const markToMarketFixedIncome = (asset, { history, calcDate }) => {
    if (!Array.isArray(history) || history.length === 0) return null;
    // Só título público é marcável. O matcher (utils/treasuryTitle) já recusa
    // CASH, mas a garantia é repetida aqui de propósito: é a última linha antes
    // do número virar patrimônio, e um contexto de preço montado errado marcaria
    // a reserva de emergência a mercado sem emitir um único aviso.
    if (asset?.type !== 'FIXED_INCOME') return null;

    // Vencido: o título é resgatado ao par e para de valer preço de mercado. A
    // série termina no vencimento, então basta pedir o PU daquele dia.
    const maturity = maturityDateOnly(asset);
    const refDate = (maturity && brazilDateOnly(calcDate).getTime() > maturity.getTime()) ? maturity : calcDate;

    const current = findTreasuryPu(history, isoDay(refDate));
    if (!current) return null;

    const lots = normalizeLots(asset);
    const value = markLotsToMarket(lots, history, current.point.date);
    if (value === null) return null;

    // O valor de ontem só considera os lotes que JÁ existiam ontem — senão a
    // compra do dia entraria na conta como se fosse valorização.
    const previous = current.index > 0 ? history[current.index - 1] : null;
    const olderLots = previous ? lots.filter((lot) => lot.dateIso <= previous.date) : [];
    const previousValue = olderLots.length > 0
        ? markLotsToMarket(olderLots, history, previous.date)
        : null;

    return {
        value,
        previousValue,
        priceDate: current.point.date,
        // PU oficial de hoje e a fração implícita que ele multiplica. Só a UI usa:
        // o valor da posição continua vindo da razão de PU sobre o custo.
        unitPrice: current.point.pu,
        units: impliedTreasuryUnits(lots, history),
    };
};

/** Como a posição foi precificada — acompanha o valor até a UI. */
export const PRICING_SOURCE = { MTM: 'MTM', ACCRUAL: 'ACCRUAL' };

/**
 * Porta ÚNICA de valorização de CASH/FIXED_INCOME. Marca a mercado quando há
 * série de PU utilizável e cai no accrual em qualquer outro caso, sempre
 * devolvendo os DOIS números para que a UI possa mostrar "mercado" e "na curva"
 * lado a lado.
 *
 * @param {Object} asset posição
 * @param {Object} opts  { cdiRate, selic, ipca, calcDate, history }
 *   `history` é a série de PU do título já resolvido pelo chamador (null = accrual)
 * @returns {{ value: number, accrued: number, market: number|null,
 *             previousMarket: number|null, source: string, priceDate: string|null,
 *             unitPrice: number|null, units: number|null }}
 *   `unitPrice`/`units` só existem no caminho MTM: são o PU oficial do título e a
 *   fração implícita que ele multiplica, para a UI exibir preço de título em vez
 *   do preço unitário digitado. Nenhum cálculo de patrimônio depende deles.
 */
export const valueFixedIncomeAsset = (asset, { cdiRate, selic, ipca, calcDate, history = null, cdiCurve = null }) => {
    const accrued = accrueFixedIncomeValue(asset, { cdiRate, selic, ipca, calcDate, cdiCurve });
    const base = { accrued, market: null, previousMarket: null, priceDate: null, unitPrice: null, units: null };

    if (!history) return { ...base, value: accrued, source: PRICING_SOURCE.ACCRUAL };

    const marked = markToMarketFixedIncome(asset, { history, calcDate });
    if (!marked) return { ...base, value: accrued, source: PRICING_SOURCE.ACCRUAL };

    return {
        ...base,
        value: marked.value,
        market: marked.value,
        previousMarket: marked.previousValue,
        priceDate: marked.priceDate,
        unitPrice: marked.unitPrice,
        units: marked.units,
        source: PRICING_SOURCE.MTM,
    };
};
