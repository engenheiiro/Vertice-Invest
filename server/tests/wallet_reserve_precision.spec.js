import { describe, it, expect } from 'vitest';
import { processWalletAsset } from '../controllers/walletController.js';
import { accrueFixedIncomeValue, brazilToday } from '../utils/fixedIncome.js';
import { safeCurrency } from '../utils/mathUtils.js';

// Regressão: uma reserva (CASH) com MUITAS "unidades" (ex.: R$15.000 a 100% CDI)
// perdia centavos porque o valor era reconstruído via quantidade × preço unitário,
// e o preço ~1,000525 era arredondado a 4 casas (1,0005) antes de multiplicar
// (15.000 × 1,0005 = 15.007,50 em vez de 15.007,88 — some R$0,38). O valor exibido
// deve derivar do TOTAL acumulado (fonte da verdade), não do preço unitário.

const macroRates = { cdiRate: 14.15, selic: 14.25, ipca: 4.72 };
const ctx = { assetMap: new Map(), usdRate: 5, usdChange: 0, macroRates, isTodayBusinessDay: true };

const makeReserve = (quantity) => ({
    type: 'CASH',
    ticker: 'RESERVA-EMERGENCIA',
    quantity,
    totalCost: quantity, // preço unitário 1,00
    currency: 'BRL',
    taxLots: [{ date: new Date('2026-06-30T00:00:00.000Z'), quantity, price: 1 }],
});

const expectedAccrued = (asset) =>
    safeCurrency(accrueFixedIncomeValue(asset, { ...macroRates, calcDate: brazilToday() }));

describe('processWalletAsset — precisão de renda fixa/caixa', () => {
    it('totalValue de uma reserva grande = TOTAL acumulado (não perde centavos)', () => {
        const asset = makeReserve(15000);
        const { processed } = processWalletAsset(asset, ctx);

        expect(processed.totalValue).toBe(expectedAccrued(asset));
        // Lucro exibido = total acumulado − custo, coerente até o centavo.
        expect(processed.profit).toBe(safeCurrency(expectedAccrued(asset) - asset.totalCost));
    });

    it('não sofre o erro do preço unitário arredondado a 4 casas', () => {
        const asset = makeReserve(15000);
        const accrued = accrueFixedIncomeValue(asset, { ...macroRates, calcDate: brazilToday() });

        // Abordagem antiga (bugada): reconstruir por preço unitário arredondado a 4 casas.
        const roundedUnitPrice = parseFloat((accrued / 15000).toFixed(4));
        const buggyTotal = safeCurrency(15000 * roundedUnitPrice);
        const correctTotal = safeCurrency(accrued);

        // O cenário realmente diverge (perde ≥ 1 centavo) e o código entrega o correto.
        expect(correctTotal).not.toBe(buggyTotal);
        expect(processWalletAsset(asset, ctx).processed.totalValue).toBe(correctTotal);
    });

    it('variação do dia também deriva do total (sem perda no fator ~1,0005)', () => {
        const asset = makeReserve(15000);
        const { processed, dayChangeValueBr } = processWalletAsset(asset, ctx);
        const accrued = accrueFixedIncomeValue(asset, { ...macroRates, calcDate: brazilToday() });
        const dayFactor = 1 + processed.dayChangePct / 100;
        const expectedDayVar = safeCurrency(accrued - accrued / dayFactor);

        // A variação do dia não pode "encolher" pela perda de precisão do fator.
        expect(Math.abs(dayChangeValueBr - expectedDayVar)).toBeLessThanOrEqual(0.01);
    });

    it('quantidade pequena permanece correta (sem regressão no caminho comum)', () => {
        const asset = makeReserve(100);
        expect(processWalletAsset(asset, ctx).processed.totalValue).toBe(expectedAccrued(asset));
    });
});
