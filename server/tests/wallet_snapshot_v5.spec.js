import { describe, expect, it } from 'vitest';
import { historyStorageKey } from '../utils/assetHistory.js';
import {
  snapshotInstantForDay,
  sumTransactionFlowBRL,
  transactionsAfterSnapshotFilter,
} from '../utils/walletSnapshot.js';
import { calculateDailyDietz } from '../utils/mathUtils.js';

describe('AssetHistory V5 — identidade por classe', () => {
  it('separa criptomoeda de ticker homônimo listado', () => {
    expect(historyStorageKey('BTC', 'CRYPTO')).toBe('BTC-USD');
    expect(historyStorageKey('BTC', 'STOCK_US')).toBe('BTC');
    expect(historyStorageKey('btc-usd', 'CRYPTO')).toBe('BTC-USD');
  });

  it('preserva benchmarks, câmbio e tickers B3', () => {
    expect(historyStorageKey('^BVSP', 'INDEX')).toBe('^BVSP');
    expect(historyStorageKey('USD-BRL', 'INDEX')).toBe('USD-BRL');
    expect(historyStorageKey('PETR4.SA', 'STOCK')).toBe('PETR4');
  });
});

describe('WalletSnapshot V5 — dia civil e high-water mark', () => {
  it('grava o fechamento em 23:59 BRT', () => {
    expect(snapshotInstantForDay('2026-07-30').toISOString()).toBe('2026-07-31T02:59:00.000Z');
  });

  it('busca tanto dias posteriores quanto lançamentos retroativos criados depois', () => {
    const calculatedAt = new Date('2026-07-30T21:28:56.000Z');
    const filter = transactionsAfterSnapshotFilter({
      dayKey: '2026-07-30', calculatedAt,
    });
    expect(filter.$or).toEqual([
      { date: { $gt: new Date('2026-07-30T23:59:59.999Z') } },
      { createdAt: { $gt: calculatedAt } },
    ]);
  });
});

describe('Fluxo base BRL — paridade scheduler/live/rebuild', () => {
  it('converte USD e preserva BRL antes do Modified Dietz', () => {
    const assets = new Map([
      ['BTC', { ticker: 'BTC', type: 'CRYPTO', currency: 'USD' }],
      ['BOVA11', { ticker: 'BOVA11', type: 'ETF', currency: 'BRL' }],
    ]);
    const txs = [
      { ticker: 'BTC', type: 'BUY', totalValue: 10, currency: 'USD', date: new Date('2026-07-30T12:00:00Z') },
      { ticker: 'BOVA11', type: 'BUY', totalValue: 100, currency: 'BRL', date: new Date('2026-07-30T12:00:00Z') },
      { ticker: 'BOVA11', type: 'SELL', totalValue: 20, currency: 'BRL', date: new Date('2026-07-30T12:00:00Z') },
    ];
    expect(sumTransactionFlowBRL(txs, assets, () => 5)).toBe(130);
  });

  it('aporte tardio não vira retorno de 400%', () => {
    const startEquity = 4_046.69;
    const lateContribution = 16_800;
    const endEquity = startEquity + lateContribution;
    expect(calculateDailyDietz(startEquity, endEquity, lateContribution)).toBeCloseTo(0, 8);
    expect(calculateDailyDietz(startEquity, endEquity, 0)).toBeGreaterThan(4);
  });
});

