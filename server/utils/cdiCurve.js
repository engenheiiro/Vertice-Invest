import EconomicIndex from '../models/EconomicIndex.js';
import { cdiAnnualRateForYear } from '../config/financialConstants.js';
import logger from '../config/logger.js';

/**
 * Curva histórica do CDI: a taxa que estava VIGENTE em cada dia útil.
 *
 * Existe porque o rendimento da renda fixa era calculado de duas maneiras
 * incompatíveis. O rebuild compunha dia a dia com o fator daquele dia
 * (`EconomicIndex`, série SELIC), enquanto o KPI ao vivo e o snapshot diário
 * compunham a taxa de HOJE sobre todo o período de custódia. Numa carteira real
 * de 01/09/2026 a série tinha dois regimes (14,15% a.a. até a queda da Selic,
 * 13,90% depois) e as duas contas nunca fechavam: R$ 3,72 de diferença teórica
 * sobre R$ 18.164 em 43 dias úteis. O vão crescia a cada mexida na Selic.
 *
 * A curva é a fonte ÚNICA dessa taxa. Resolução, em ordem:
 *   1. fator diário gravado para o dia (`accumulatedFactor` da série SELIC);
 *   2. CDI médio do ano-calendário (`HISTORICAL_CDI_RATES`);
 *   3. taxa corrente — o que o sistema já fazia antes de haver curva.
 *
 * É exatamente a cadeia que o rebuild usava, agora compartilhada com os outros
 * caminhos em vez de reimplementada em cada um.
 */

const DAYS_PER_YEAR = 252;

/** Fator diário gravado (1,000516…) → taxa anual equivalente (13,90). */
export const annualRateFromDailyFactor = (factor) => {
    const f = Number(factor);
    if (!Number.isFinite(f) || f <= 0) return null;
    const annual = (Math.pow(f, DAYS_PER_YEAR) - 1) * 100;
    return Number.isFinite(annual) && annual > 0 ? annual : null;
};

/**
 * Curva vazia: todo dia cai na taxa corrente informada pelo chamador. É o
 * comportamento anterior à curva, preservado como fail-open — série indisponível
 * degrada a precisão, nunca derruba o cálculo do patrimônio.
 */
export const EMPTY_CDI_CURVE = { annualRateFor: () => null, size: 0 };

/**
 * @param {Array<{date: Date, accumulatedFactor: number}>} rows série SELIC
 * @param {{currentRate?: number, currentYear?: number}} opts
 */
export const buildCdiCurve = (rows, { currentRate, currentYear = new Date().getFullYear() } = {}) => {
    const byDay = new Map();
    for (const row of rows || []) {
        const annual = annualRateFromDailyFactor(row?.accumulatedFactor);
        if (annual === null || !row?.date) continue;
        byDay.set(new Date(row.date).toISOString().slice(0, 10), annual);
    }

    return {
        size: byDay.size,
        annualRateFor(dayKey) {
            const exact = byDay.get(dayKey);
            if (Number.isFinite(exact)) return exact;
            const year = Number(String(dayKey || '').slice(0, 4));
            if (!Number.isFinite(year)) return null;
            // `fallback: 10` reproduz o default histórico do rebuild — mudá-lo aqui
            // reescreveria silenciosamente a rentabilidade de carteiras antigas.
            return cdiAnnualRateForYear(year, { currentRate, currentYear, fallback: 10.0 });
        },
    };
};

/**
 * Carrega a curva do banco. `since` limita a leitura ao período que interessa
 * (a data do lote mais antigo); sem ele, a série inteira.
 */
export const loadCdiCurve = async ({ since, currentRate } = {}) => {
    const filter = { series: 'SELIC' };
    if (since instanceof Date && Number.isFinite(since.getTime())) {
        filter.date = { $gte: since };
    }
    try {
        const rows = await EconomicIndex.find(filter).lean();
        return buildCdiCurve(rows, { currentRate });
    } catch (error) {
        // Fail-open deliberado: sem a série, cada dia rende pela taxa corrente —
        // exatamente o que o sistema fazia antes da curva existir. Perder precisão
        // é aceitável; deixar de renderizar o patrimônio do usuário não é.
        logger.warn(`[CdiCurve] Série SELIC indisponível, usando taxa corrente: ${error.message}`);
        return EMPTY_CDI_CURVE;
    }
};

/**
 * Data do lote mais antigo de renda fixa/caixa de um conjunto de posições — o
 * ponto a partir do qual a curva precisa existir. `null` quando não há RF.
 */
export const earliestFixedIncomeLotDate = (assets) => {
    let earliest = null;
    for (const asset of assets || []) {
        if (asset?.type !== 'CASH' && asset?.type !== 'FIXED_INCOME') continue;
        const dates = (asset.taxLots || []).map((lot) => new Date(lot.date));
        if (dates.length === 0 && asset.startDate) dates.push(new Date(asset.startDate));
        for (const d of dates) {
            if (!Number.isFinite(d.getTime())) continue;
            if (earliest === null || d < earliest) earliest = d;
        }
    }
    return earliest;
};
