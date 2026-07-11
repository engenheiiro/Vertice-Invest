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
 */
import { countBusinessDays } from './dateUtils.js';

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
export const accrueFixedIncomeValue = (asset, { cdiRate, selic, ipca, calcDate }) => {
    const dailyFactor = assetDailyFactor(asset, { cdiRate, selic, ipca });
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

    let value = 0;
    for (const lot of lots) {
        const startDate = brazilDateOnly(lot.date);
        const businessDays = countBusinessDays(startDate, endDate);
        let compoundFactor = Math.pow(dailyFactor, businessDays);
        if (!isFinite(compoundFactor) || compoundFactor < 1) compoundFactor = 1;
        value += (isCash ? lot.quantity : lot.quantity * lot.price) * compoundFactor;
    }
    return value;
};
