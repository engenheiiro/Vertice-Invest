import { describe, expect, it, vi } from 'vitest';
import { applyDayTransactions } from '../utils/rebuildDayTransactions.js';

const DAY = '2026-03-16';
const NO_SERIES = { historyFor: () => null };

const tx = (override = {}) => ({
  ticker: 'PETR4', type: 'BUY', quantity: 10, price: 30, totalValue: 300, currency: 'BRL',
  date: new Date(`${DAY}T12:00:00Z`), ...override,
});

const context = (txs, override = {}) => ({
  txs, txIndex: 0, cursorIso: DAY, portfolio: {}, fixedIncomeState: {},
  assetMetadataMap: new Map(), priceCacheMap: new Map(), lastKnownPrices: {},
  getUsdRateForDate: () => 5, treasuryPricing: NO_SERIES, ...override,
});

const noPrice = () => ({ close: 0, adjClose: 0 });

describe('applyDayTransactions — fluxo ajustado pelo candle', () => {
  it('ajusta o fluxo pela razão adjClose/close e guarda o último preço da compra', () => {
    const ctx = context([tx()]);
    const result = applyDayTransactions(ctx, () => ({ close: 30, adjClose: 27 }));
    expect(result).toEqual({ txIndex: 1, dayFlowAdjusted: 270, dayFlowNominal: 300 });
    expect(ctx.lastKnownPrices.PETR4).toEqual({ close: 30, adjClose: 27 });
  });

  it('sem close no candle, o fluxo ajustado é quantidade × adjClose', () => {
    const result = applyDayTransactions(context([tx()]), () => ({ close: 0, adjClose: 25 }));
    expect(result.dayFlowAdjusted).toBe(250);
  });

  it('lançamento que não é compra nem venda não gera fluxo, mas posição vazia é zerada', () => {
    const ctx = context([tx({ type: 'DIVIDEND' })], { portfolio: { PETR4: { qty: 1e-12, cost: 5, costBrl: 5 } } });
    expect(applyDayTransactions(ctx, noPrice)).toEqual({ txIndex: 1, dayFlowAdjusted: 0, dayFlowNominal: 0 });
    expect(ctx.portfolio.PETR4).toEqual({ qty: 0, cost: 0, costBrl: 0 });
  });
});

describe('applyDayTransactions — renda fixa', () => {
  const cdb = { ticker: 'CDB', type: 'FIXED_INCOME', fixedIncomeRate: 0 };

  it('RF sem taxa abre o estado com 100 (% do CDI), como o caminho ao vivo (abria com 10)', () => {
    const findPrice = vi.fn(noPrice);
    const ctx = context([tx({ ticker: 'CDB', quantity: 1, price: 1000, totalValue: 1000 })], {
      assetMetadataMap: new Map([['CDB', cdb]]),
    });
    applyDayTransactions(ctx, findPrice);
    expect(findPrice).not.toHaveBeenCalled();
    expect(ctx.fixedIncomeState.CDB).toMatchObject({ rate: 100, currentValue: 1000, lots: [{ dateIso: DAY, cost: 1000, qty: 1 }] });
  });

  it('posição que já existia sem estado ganha o estado tardio, com taxa 100', () => {
    const ctx = context([tx({ ticker: 'CDB', quantity: 1, price: 1000, totalValue: 1000 })], {
      assetMetadataMap: new Map([['CDB', cdb]]),
      portfolio: { CDB: { qty: 1, cost: 900, costBrl: 900 } },
    });
    applyDayTransactions(ctx, noPrice);
    expect(ctx.fixedIncomeState.CDB.rate).toBe(100);
  });

  it('taxa negativa vale como ausente também no estado tardio (passava -1)', () => {
    const ctx = context([tx({ ticker: 'CDB', quantity: 1, price: 1000, totalValue: 1000 })], {
      assetMetadataMap: new Map([['CDB', { ...cdb, fixedIncomeRate: -1 }]]),
      portfolio: { CDB: { qty: 1, cost: 900, costBrl: 900 } },
    });
    applyDayTransactions(ctx, noPrice);
    expect(ctx.fixedIncomeState.CDB.rate).toBe(100);
  });

  it('estado de abertura e tardio saem com a mesma taxa para a mesma RF', () => {
    const meta = { ...cdb, fixedIncomeRate: 112 };
    const opening = context([tx({ ticker: 'CDB', quantity: 1, totalValue: 1000 })], { assetMetadataMap: new Map([['CDB', meta]]) });
    const late = context([tx({ ticker: 'CDB', quantity: 1, totalValue: 1000 })], {
      assetMetadataMap: new Map([['CDB', meta]]), portfolio: { CDB: { qty: 1, cost: 900, costBrl: 900 } },
    });
    applyDayTransactions(opening, noPrice);
    applyDayTransactions(late, noPrice);
    expect(opening.fixedIncomeState.CDB.rate).toBe(112);
    expect(late.fixedIncomeState.CDB.rate).toBe(112);
  });

  it('venda de RF numa posição sem estado de RF não lança TypeError (lançava)', () => {
    const ctx = context([tx({ ticker: 'CDB', type: 'SELL', quantity: 1, price: 1000, totalValue: 1000 })], {
      assetMetadataMap: new Map([['CDB', cdb]]),
      portfolio: { CDB: { qty: 2, cost: 1800, costBrl: 1800 } },
    });
    expect(() => applyDayTransactions(ctx, noPrice)).not.toThrow();
    expect(ctx.portfolio.CDB).toEqual({ qty: 1, cost: 900, costBrl: 900 });
    expect(ctx.fixedIncomeState.CDB).toMatchObject({ rate: 100, currentValue: 0, lots: [] });
  });

  it('compra anterior ao início da série de PU abandona a marcação do título', () => {
    const series = [{ date: '2026-03-10', pu: 1000, puBuy: 1000 }];
    const ctx = context([tx({ ticker: 'TD', quantity: 1, price: 900, totalValue: 900, date: new Date('2026-02-01T12:00:00Z') })], {
      assetMetadataMap: new Map([['TD', { ticker: 'TD', type: 'FIXED_INCOME' }]]),
      treasuryPricing: { historyFor: () => series },
    });
    applyDayTransactions(ctx, noPrice);
    expect(ctx.fixedIncomeState.TD.history).toBeNull();
  });

  it('custo, valor da RF e fluxo somam em 4 casas (somavam float cru: 0,1 + 0,2 = 0,30000000000000004)', () => {
    const ctx = context([
      tx({ ticker: 'CDB', quantity: 1, price: 0.1, totalValue: 0.1 }),
      tx({ ticker: 'CDB', quantity: 1, price: 0.2, totalValue: 0.2 }),
    ], { assetMetadataMap: new Map([['CDB', cdb]]) });
    const result = applyDayTransactions(ctx, noPrice);
    expect(ctx.portfolio.CDB).toEqual({ qty: 2, cost: 0.3, costBrl: 0.3 });
    expect(ctx.fixedIncomeState.CDB.currentValue).toBe(0.3);
    expect(result).toEqual({ txIndex: 2, dayFlowAdjusted: 0.3, dayFlowNominal: 0.3 });
  });

  it('lote sem quantidade derruba o resgate para a baixa proporcional', () => {
    const ctx = context([tx({ ticker: 'CDB', type: 'SELL', quantity: 1, totalValue: 500 })], {
      assetMetadataMap: new Map([['CDB', cdb]]),
      portfolio: { CDB: { qty: 4, cost: 4000, costBrl: 4000 } },
      fixedIncomeState: { CDB: { currentValue: 4000, lots: [{ dateIso: '2026-01-01', cost: 4000 }] } },
    });
    const result = applyDayTransactions(ctx, noPrice);
    expect(ctx.fixedIncomeState.CDB.lots).toEqual([{ dateIso: '2026-01-01', cost: 3000 }]);
    expect(ctx.fixedIncomeState.CDB.currentValue).toBe(3500);
    expect(result.dayFlowNominal).toBe(-500);
  });
});
