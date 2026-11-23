import { describe, expect, it } from 'vitest';
import { buildUsdRateResolver } from '../utils/fxRate.js';
import { applyLedgerToAsset, replayPositionLedger } from '../services/positionRecalc.js';
import { sumTransactionFlowBRL } from '../utils/walletSnapshot.js';
import { settlePeriodFlow } from '../controllers/walletKpis.js';

// Regra 13: sem série USD/BRL e sem cotação na macro, o resolvedor devolvia
// 5,75 fixo — e o recálculo o gravava como câmbio do lançamento e no custo em
// reais da posição. Decisão do dono (23/11/2026): o lançamento entra SEM
// carimbo e com o custo em reais nulo ("não migrado"); o próximo recálculo com
// câmbio real carimba.
const insufficientBalance = () => new Error('saldo');
const tx = (over) => ({ _id: over.id, type: 'BUY', quantity: 10, price: 100, date: new Date('2026-11-20T12:00:00Z'), ...over });

describe('câmbio ausente — nada de 5,75 gravado', () => {
    it('sem série nem cotação, o resolvedor devolve nulo em vez de 5,75', () => {
        const resolve = buildUsdRateResolver([], null);
        expect(resolve('2026-11-20')).toBeNull();
        expect(resolve.hasSeries).toBe(false);
        expect(buildUsdRateResolver([{ date: '2026-07-01', close: Infinity }], Infinity)('2026-07-15')).toBeNull();
    });

    it('recálculo sem câmbio não carimba o lançamento e deixa o custo em reais nulo', () => {
        const ledger = replayPositionLedger(
            [tx({ id: 'a' }), tx({ id: 'b', type: 'SELL', quantity: 4, price: 110 })],
            { nativeCurrency: 'USD', rateOf: () => null, insufficientBalance },
        );
        expect(ledger.fxToStamp).toEqual([]);
        expect(ledger.totalCostBrl).toBeNull();
        expect(ledger.realizedProfitBrl).toBeNull();
        expect(ledger.taxLots[0].fxRate).toBeNull();
        // O nativo segue intacto: só o espelho em reais fica "não migrado".
        expect(ledger.quantity).toBe(6);
        expect(ledger.totalCost).toBe(600);

        const asset = { type: 'STOCK_US' };
        applyLedgerToAsset(asset, ledger);
        expect(asset.totalCostBrl).toBeNull();
        expect(asset.realizedProfitBrl).toBeNull();
    });

    it('um lançamento já carimbado mantém o câmbio; só o sem carimbo envenena o espelho', () => {
        const ledger = replayPositionLedger(
            [tx({ id: 'a', fxRate: 5.1 }), tx({ id: 'b' })],
            { nativeCurrency: 'USD', rateOf: (t) => (t.fxRate > 0 ? t.fxRate : null), insufficientBalance },
        );
        expect(ledger.fxToStamp).toEqual([]);
        expect(ledger.totalCostBrl).toBeNull();
        expect(ledger.taxLots.map((l) => l.fxRate)).toEqual([5.1, null]);
    });

    it('com câmbio real tudo segue como antes (carimba o legado)', () => {
        const ledger = replayPositionLedger([tx({ id: 'a' })], { nativeCurrency: 'USD', rateOf: () => 5.2, insufficientBalance });
        expect(ledger.fxToStamp).toEqual([{ id: 'a', fxRate: 5.2 }]);
        expect(ledger.totalCostBrl).toBe(5200);
    });

    it('fluxo do período sem câmbio vira "não calculável" (nulo), sem derrubar a carteira', async () => {
        const semCambio = () => sumTransactionFlowBRL(
            [{ ticker: 'AAPL', type: 'BUY', quantity: 1, price: 100, totalValue: 100, date: new Date('2026-11-20T12:00:00Z'), currency: 'USD' }],
            new Map([['AAPL', { ticker: 'AAPL', type: 'STOCK_US', currency: 'USD' }]]),
            () => null,
        );
        expect(semCambio).toThrow(RangeError);
        expect(await settlePeriodFlow(Promise.resolve().then(semCambio))).toBeNull();
        expect(await settlePeriodFlow(Promise.resolve(150))).toBe(150);
        await expect(settlePeriodFlow(Promise.reject(new Error('banco caiu')))).rejects.toThrow('banco caiu');
    });
});
