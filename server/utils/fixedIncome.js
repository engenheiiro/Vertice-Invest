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
 * Valor acumulado de um ativo CASH/FIXED_INCOME numa data, compondo CADA lote
 * desde sua data de compra pelos dias úteis (réplica exata da lógica de
 * getWalletData, agora compartilhada). Lote comprado HOJE rende 0 (dias úteis = 0).
 *
 * @param {Object} asset { type, taxLots?, quantity, totalCost, fixedIncomeRate, startDate?, createdAt? }
 * @param {Object} opts  { cdiRate, calcDate }
 * @returns {number} valor acumulado (na moeda do ativo; multiplicador cambial é aplicado pelo chamador)
 */
export const accrueFixedIncomeValue = (asset, { cdiRate, calcDate }) => {
    const dailyFactor = fixedIncomeDailyFactor(asset.fixedIncomeRate, cdiRate);
    const isCash = asset.type === 'CASH';

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
        const businessDays = countBusinessDays(startDate, calcDate);
        let compoundFactor = Math.pow(dailyFactor, businessDays);
        if (!isFinite(compoundFactor) || compoundFactor < 1) compoundFactor = 1;
        value += (isCash ? lot.quantity : lot.quantity * lot.price) * compoundFactor;
    }
    return value;
};
