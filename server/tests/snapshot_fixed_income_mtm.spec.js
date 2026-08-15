import { describe, it, expect } from 'vitest';
import { computeEquityAt } from '../services/schedulerService.js';
import { valueFixedIncomeAsset, brazilToday } from '../utils/fixedIncome.js';

// ─────────────────────────────────────────────────────────────────────────────
// O snapshot diário precisa marcar a renda fixa pela MESMA régua do KPI ao vivo.
//
// Este caminho tem um modo de falha SILENCIOSO: se `treasuryPricing` não chegar
// no contexto do snapshot, `computeEquityAt` cai no default vazio e volta a
// gravar o valor na curva — sem erro, sem log, só um histórico que diverge do
// card do ativo. O degrau na curva de patrimônio só apareceria semanas depois.
//
// Por isso o teste afirma as duas metades: que COM série o snapshot marca (e
// bate no centavo com a porta única de valorização), e que SEM série ele volta
// ao accrual — que é o fallback correto, não um bug.
// ─────────────────────────────────────────────────────────────────────────────

const macroRates = { cdiRate: 14.15, selic: 14.25, ipca: 4.72 };
const calcDate = brazilToday();

const DAY_MS = 86400000;
const dayIso = (offset) => new Date(calcDate.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
const dayDate = (offset) => new Date(`${dayIso(offset)}T00:00:00.000Z`);

const history = [
    { date: dayIso(-3), pu: 1000, puBuy: 1010 },
    { date: dayIso(-1), pu: 1080, puBuy: 1090 },
    { date: dayIso(0), pu: 1111, puBuy: 1121 },
];

const titulo = {
    type: 'FIXED_INCOME',
    ticker: 'TESOURO IPCA+ 2035',
    name: 'Tesouro IPCA+ 2035',
    quantity: 1,
    totalCost: 1000,
    currency: 'BRL',
    fixedIncomeIndex: 'IPCA',
    fixedIncomeSpread: 6.2,
    taxLots: [{ date: dayDate(-3), quantity: 1, price: 1000 }],
};

const pricingCom = { historyFor: () => history, resolve: () => ({ key: 'IPCA|2035-05-15' }), catalog: [], series: new Map() };
const baseCtx = { priceMap: new Map(), closeMap: new Map(), macroRates, usdRate: 5, calcDate };

describe('computeEquityAt — renda fixa no snapshot diário', () => {
    it('marca a mercado quando o contexto traz a série de PU', () => {
        const { totalEquity } = computeEquityAt([titulo], { ...baseCtx, treasuryPricing: pricingCom });
        expect(totalEquity).toBeCloseTo(1000 * (1111 / 1010), 6);
    });

    it('bate no centavo com a porta única usada pelo KPI ao vivo', () => {
        const { totalEquity } = computeEquityAt([titulo], { ...baseCtx, treasuryPricing: pricingCom });
        const kpi = valueFixedIncomeAsset(titulo, { ...macroRates, calcDate, history });
        expect(totalEquity).toBe(kpi.value);
    });

    it('sem contexto de PU, volta ao accrual em vez de quebrar', () => {
        const { totalEquity } = computeEquityAt([titulo], baseCtx);
        const naCurva = valueFixedIncomeAsset(titulo, { ...macroRates, calcDate, history: null });
        expect(totalEquity).toBe(naCurva.value);
        // E o accrual difere mesmo da marcação — senão o teste acima passaria à toa.
        expect(totalEquity).not.toBeCloseTo(1000 * (1111 / 1010), 2);
    });

    it('reserva/caixa segue na curva mesmo com série disponível', () => {
        const reserva = {
            type: 'CASH',
            ticker: 'RESERVA-EMERGENCIA',
            quantity: 15000,
            totalCost: 15000,
            currency: 'BRL',
            taxLots: [{ date: dayDate(-3), quantity: 15000, price: 1 }],
        };
        const { totalEquity } = computeEquityAt([reserva], { ...baseCtx, treasuryPricing: pricingCom });
        const naCurva = valueFixedIncomeAsset(reserva, { ...macroRates, calcDate, history: null });
        expect(totalEquity).toBe(naCurva.value);
    });
});
