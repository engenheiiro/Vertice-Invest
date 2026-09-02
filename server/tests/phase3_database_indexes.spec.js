import { describe, expect, it } from 'vitest';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import JobLease from '../models/JobLease.js';
import JobCheckpoint from '../models/JobCheckpoint.js';

const hasIndex = (model, expected, predicate = () => true) =>
  model.schema.indexes().some(([keys, options]) =>
    JSON.stringify(keys) === JSON.stringify(expected) && predicate(options));

describe('Fase 3 — índices alinhados às consultas quentes', () => {
  it('extrato por carteira não precisa ordenar date/createdAt em memória', () => {
    expect(hasIndex(AssetTransaction, { wallet: 1, date: -1, createdAt: -1 })).toBe(true);
  });

  it('transações por ticker não precisam ordenar date/createdAt em memória', () => {
    expect(hasIndex(AssetTransaction, { wallet: 1, ticker: 1, date: -1, createdAt: -1 })).toBe(true);
  });

  it('histórico de snapshots continua coberto por wallet/date', () => {
    expect(hasIndex(WalletSnapshot, { wallet: 1, date: 1 })).toBe(true);
  });

  it('lease é único por job e checkpoint é único por job/run/item', () => {
    expect(hasIndex(JobLease, { jobId: 1 }, (options) => options.unique === true)).toBe(true);
    expect(hasIndex(
      JobCheckpoint,
      { jobId: 1, runKey: 1, itemKey: 1 },
      (options) => options.unique === true,
    )).toBe(true);
  });
});
