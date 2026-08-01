import mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import WalletSnapshot from '../models/WalletSnapshot.js';
import { historyStorageKey } from '../utils/assetHistory.js';
import {
  brazilDayKey,
  isTwrrReturnAnomalous,
  isValidDayKey,
  snapshotInstantForDay,
  sumTransactionFlowBRL,
  transactionsAfterSnapshotFilter,
  upsertWalletSnapshotForDay,
  utcEndOfCalendarDay,
} from '../utils/walletSnapshot.js';
import {
  calculateDailyDietz,
  calculateSharpeRatio,
  calculateStdDev,
  computeLiveQuota,
  safeCurrency,
  safeFloat,
  safeQuantity,
} from '../utils/mathUtils.js';

describe('WalletSnapshot V5 — datas civis e virada do dia', () => {
  it.each([
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-04-31', false],
    ['2026-12-31', true],
    ['2026-7-01', false],
    ['', false],
    [null, false],
  ])('valida dayKey %j', (dayKey, expected) => {
    expect(isValidDayKey(dayKey)).toBe(expected);
  });

  it('mantém 23:59 BRT inclusive em ano bissexto e virada de ano', () => {
    expect(snapshotInstantForDay('2024-02-29').toISOString()).toBe('2024-03-01T02:59:00.000Z');
    expect(snapshotInstantForDay('2026-12-31').toISOString()).toBe('2027-01-01T02:59:00.000Z');
  });

  it('rejeita datas impossíveis em vez de persistir Invalid Date', () => {
    expect(() => snapshotInstantForDay('2026-02-30')).toThrow(RangeError);
    expect(() => utcEndOfCalendarDay('texto')).toThrow(RangeError);
  });

  it('mapeia corretamente os dois lados da meia-noite de Brasília', () => {
    expect(brazilDayKey(new Date('2026-08-01T02:59:59.999Z'))).toBe('2026-07-31');
    expect(brazilDayKey(new Date('2026-08-01T03:00:00.000Z'))).toBe('2026-08-01');
  });

  it('usa fim do dia econômico UTC nas transações e high-water de criação', () => {
    const calculatedAt = new Date('2026-07-31T02:59:00.000Z');
    expect(transactionsAfterSnapshotFilter({ dayKey: '2026-07-30', calculatedAt })).toEqual({
      $or: [
        { date: { $gt: new Date('2026-07-30T23:59:59.999Z') } },
        { createdAt: { $gt: calculatedAt } },
      ],
    });
  });

  it('é compatível com snapshot legado sem dayKey e calculatedAt', () => {
    const filter = transactionsAfterSnapshotFilter({
      date: new Date('2026-07-31T02:59:00.000Z'),
      createdAt: new Date('2026-07-31T03:10:00.000Z'),
    });
    expect(filter.$or[0].date.$gt.toISOString()).toBe('2026-07-30T23:59:59.999Z');
    expect(filter.$or[1].createdAt.$gt.toISOString()).toBe('2026-07-31T03:10:00.000Z');
  });

  it('sem snapshot não filtra transações e metadado corrompido falha fechado', () => {
    expect(transactionsAfterSnapshotFilter(null)).toEqual({});
    expect(() => transactionsAfterSnapshotFilter({ dayKey: '2026-07-30', calculatedAt: 'inválido' }))
      .toThrow('calculatedAt inválido');
  });
});

describe('WalletSnapshot V5 — identidade tipada do histórico', () => {
  it.each([
    [' btc ', 'crypto', 'BTC-USD'],
    ['BTC-USD', 'CRYPTO', 'BTC-USD'],
    ['eth-usd', 'crypto', 'ETH-USD'],
    ['PETR4.SA', 'stock', 'PETR4'],
    ['BTC', 'STOCK_US', 'BTC'],
    ['^BVSP', 'INDEX', '^BVSP'],
    ['USD-BRL', null, 'USD-BRL'],
    ['', 'CRYPTO', ''],
  ])('%j/%j → %j', (ticker, type, expected) => {
    expect(historyStorageKey(ticker, type)).toBe(expected);
  });

  it('é idempotente para símbolo cripto já normalizado', () => {
    const once = historyStorageKey('BTC', 'CRYPTO');
    expect(historyStorageKey(once, 'CRYPTO')).toBe(once);
  });
});

describe('WalletSnapshot V5 — fluxo BRL e moedas', () => {
  const date = new Date('2026-07-30T12:00:00.000Z');
  const assets = new Map([
    ['BTC', { ticker: 'BTC', type: 'CRYPTO' }],
    ['AAPL', { ticker: 'AAPL', type: 'STOCK_US' }],
    ['VOO', { ticker: 'VOO', type: 'ETF', currency: 'USD' }],
    ['BOVA11', { ticker: 'BOVA11', type: 'ETF', currency: 'BRL' }],
  ]);

  it('soma aportes e resgates mistos usando câmbio histórico', () => {
    const transactions = [
      { ticker: 'BTC', type: 'BUY', totalValue: 10, date },
      { ticker: 'AAPL', type: 'SELL', totalValue: 5, date },
      { ticker: 'VOO', type: 'BUY', totalValue: 2, date },
      { ticker: 'BOVA11', type: 'BUY', totalValue: 100, date },
    ];
    expect(sumTransactionFlowBRL(transactions, assets, () => 5)).toBe(135);
  });

  it('moeda persistida na transação prevalece sobre a posição atual', () => {
    const tx = { ticker: 'BTC', type: 'BUY', totalValue: 10, currency: 'BRL', date };
    expect(sumTransactionFlowBRL([tx], assets, () => 5)).toBe(10);
  });

  it('consulta um câmbio para cada data econômica', () => {
    const resolver = vi.fn((day) => (day === '2026-07-30' ? 5 : 6));
    const transactions = [
      { ticker: 'BTC', type: 'BUY', totalValue: 10, date },
      { ticker: 'BTC', type: 'BUY', totalValue: 10, date: new Date('2026-07-31T12:00:00Z') },
    ];
    expect(sumTransactionFlowBRL(transactions, assets, resolver)).toBe(110);
    expect(resolver.mock.calls.map(([day]) => day)).toEqual(['2026-07-30', '2026-07-31']);
  });

  it('resolve ticker legado ignorando diferença de caixa', () => {
    const tx = { ticker: 'btc', type: 'BUY', totalValue: 1, date };
    expect(sumTransactionFlowBRL([tx], assets, 5)).toBe(5);
  });

  it('lista vazia é neutra e não exige câmbio', () => {
    expect(sumTransactionFlowBRL([], assets, undefined)).toBe(0);
    expect(sumTransactionFlowBRL(null, assets, undefined)).toBe(0);
  });

  it.each([
    [{ ticker: 'BTC', type: 'TRANSFER', totalValue: 10, date }, 5, 'Tipo de transação inválido'],
    [{ ticker: 'BTC', type: 'BUY', totalValue: -1, date }, 5, 'Valor de transação inválido'],
    [{ ticker: 'BTC', type: 'BUY', totalValue: Infinity, date }, 5, 'Valor de transação inválido'],
    [{ ticker: 'BTC', type: 'BUY', totalValue: 1, date: 'x' }, 5, 'Data de transação inválida'],
    [{ ticker: 'BTC', type: 'BUY', totalValue: 1, date }, 0, 'Câmbio USD/BRL inválido'],
    [{ ticker: 'BTC', type: 'BUY', totalValue: 1, date }, Infinity, 'Câmbio USD/BRL inválido'],
  ])('falha fechado para lançamento ou câmbio corrompido', (tx, rate, message) => {
    expect(() => sumTransactionFlowBRL([tx], assets, rate)).toThrow(message);
  });

  it('mantém simetria BUY/SELL em uma matriz determinística de 200 fluxos', () => {
    let seed = 17;
    const random = () => {
      seed = (seed * 48271) % 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const buys = Array.from({ length: 200 }, (_, index) => ({
      ticker: index % 2 ? 'BTC' : 'BOVA11',
      type: 'BUY',
      totalValue: Number((random() * 10_000).toFixed(4)),
      date: new Date(Date.UTC(2026, 6, 1 + (index % 28), 12)),
    }));
    const sells = buys.map((tx) => ({ ...tx, type: 'SELL' }));
    const buyFlow = sumTransactionFlowBRL(buys, assets, () => 5.1);
    const sellFlow = sumTransactionFlowBRL(sells, assets, () => 5.1);
    expect(Number.isFinite(buyFlow)).toBe(true);
    expect(sellFlow).toBeCloseTo(-buyFlow, 3);
  });
});

describe('WalletSnapshot V5 — circuit breaker único', () => {
  it.each([
    [0, false],
    [0.5, false],
    [-0.5, false],
    [0.500001, true],
    [-0.500001, true],
    [NaN, true],
    [Infinity, true],
  ])('classifica retorno %s', (value, expected) => {
    expect(isTwrrReturnAnomalous(value)).toBe(expected);
  });
});

describe('WalletSnapshot V5 — concorrência e idempotência do upsert', () => {
  const payload = { wallet: 'w1', dayKey: '2026-07-31', quotaPrice: 101 };

  it('faz upsert validado no caminho normal', async () => {
    const saved = { _id: 's1', ...payload };
    const model = { findOneAndUpdate: vi.fn().mockResolvedValue(saved) };
    await expect(upsertWalletSnapshotForDay(model, 'w1', payload.dayKey, payload)).resolves.toBe(saved);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { wallet: 'w1', dayKey: payload.dayKey },
      { $set: payload },
      expect.objectContaining({ upsert: true, runValidators: true }),
    );
  });

  it('em E11000 atualiza o vencedor da corrida sem criar duplicata', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), { code: 11000 });
    const winner = { _id: 'winner', ...payload };
    const model = { findOneAndUpdate: vi.fn().mockRejectedValueOnce(duplicate).mockResolvedValueOnce(winner) };
    await expect(upsertWalletSnapshotForDay(model, 'w1', payload.dayKey, payload)).resolves.toBe(winner);
    expect(model.findOneAndUpdate).toHaveBeenLastCalledWith(
      { wallet: 'w1', dayKey: payload.dayKey },
      { $set: payload },
      expect.objectContaining({ upsert: false, runValidators: true }),
    );
  });

  it('propaga falha comum e E11000 sem vencedor', async () => {
    const dbDown = Object.assign(new Error('db down'), { code: 91 });
    await expect(upsertWalletSnapshotForDay(
      { findOneAndUpdate: vi.fn().mockRejectedValue(dbDown) }, 'w1', payload.dayKey, payload,
    )).rejects.toBe(dbDown);

    const duplicate = Object.assign(new Error('duplicate key'), { code: 11000 });
    const model = { findOneAndUpdate: vi.fn().mockRejectedValueOnce(duplicate).mockResolvedValueOnce(null) };
    await expect(upsertWalletSnapshotForDay(model, 'w1', payload.dayKey, payload)).rejects.toBe(duplicate);
  });
});

describe('WalletSnapshot V5 — validações do schema', () => {
  const validSnapshot = () => ({
    user: new mongoose.Types.ObjectId(),
    wallet: new mongoose.Types.ObjectId(),
    date: snapshotInstantForDay('2026-07-31'),
    dayKey: '2026-07-31',
    source: 'DAILY',
    calculationVersion: 5,
    totalEquity: 1_000,
    totalInvested: 900,
    quotaPrice: 101,
  });

  it('aceita fechamento V5 íntegro', async () => {
    await expect(new WalletSnapshot(validSnapshot()).validate()).resolves.toBeUndefined();
  });

  it.each([
    [{ dayKey: '2026-02-30' }, 'dayKey'],
    [{ date: new Date('2026-07-31T00:00:00Z') }, 'date'],
    [{ totalEquity: -1 }, 'totalEquity'],
    [{ totalInvested: -1 }, 'totalInvested'],
    [{ quotaPrice: 0 }, 'quotaPrice'],
  ])('rejeita snapshot corrompido: %j', async (override, field) => {
    const doc = new WalletSnapshot({ ...validSnapshot(), ...override });
    await expect(doc.validate()).rejects.toMatchObject({ errors: expect.objectContaining({ [field]: expect.anything() }) });
  });

  it('mantém compatibilidade de leitura com snapshot legado sem dayKey', async () => {
    const legacy = new WalletSnapshot({
      ...validSnapshot(),
      dayKey: null,
      date: new Date('2026-07-30T21:28:00Z'),
      source: 'LEGACY',
      calculationVersion: 4,
    });
    await expect(legacy.validate()).resolves.toBeUndefined();
  });

  it('declara índice único parcial por carteira/dia', () => {
    const index = WalletSnapshot.schema.indexes().find(([keys]) => keys.wallet === 1 && keys.dayKey === 1);
    expect(index).toEqual([
      { wallet: 1, dayKey: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { dayKey: { $type: 'string' } },
      }),
    ]);
  });
});

describe('WalletSnapshot V5 — matemática defensiva e propriedades', () => {
  it('helpers seguros nunca propagam string numérica, NaN ou infinito', () => {
    expect(safeFloat('12.34567')).toBe(12.3457);
    expect(safeCurrency('12.345')).toBe(12.35);
    expect(safeQuantity('0.00000001')).toBe(0.00000001);
    for (const invalid of [NaN, Infinity, -Infinity, 'x', undefined]) {
      expect(safeFloat(invalid)).toBe(0);
      expect(safeCurrency(invalid)).toBe(0);
      expect(safeQuantity(invalid)).toBe(0);
    }
  });

  it('aporte e resgate sem oscilação produzem retorno zero', () => {
    expect(calculateDailyDietz(1_000, 1_500, 500)).toBeCloseTo(0, 12);
    expect(calculateDailyDietz(1_000, 600, -400)).toBeCloseTo(0, 12);
    expect(calculateDailyDietz(0, 500, 500)).toBeCloseTo(0, 12);
  });

  it('provento compensa exatamente a queda no preço', () => {
    expect(calculateDailyDietz(1_000, 990, 0, 10)).toBeCloseTo(0, 12);
  });

  it('Modified Dietz permanece finito em 2.000 combinações determinísticas', () => {
    let seed = 91;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 2_000; i++) {
      const start = random() * 1_000_000;
      const flow = (random() - 0.5) * start * 2;
      const end = Math.max(0, start + flow + (random() - 0.5) * start);
      const income = random() * 1_000;
      expect(Number.isFinite(calculateDailyDietz(start, end, flow, income))).toBe(true);
    }
  });

  it('inputs não finitos do Dietz são neutralizados', () => {
    expect(Number.isFinite(calculateDailyDietz(Infinity, NaN, -Infinity, NaN))).toBe(true);
  });

  it('Sharpe filtra observações inválidas e taxa livre de risco corrompida', () => {
    const returns = [0.1, 0.2, 0.05, -0.1, 0.3, 0.15, -0.05, 0.08, 0.12, 0.18, NaN, Infinity];
    expect(Number.isFinite(calculateSharpeRatio(returns, 'inválida'))).toBe(true);
    expect(calculateStdDev([1, 2, NaN, Infinity])).toBeCloseTo(Math.SQRT1_2, 8);
    expect(calculateSharpeRatio([1, 2, NaN], 14)).toBe(0);
  });

  it('cota live falha fechado em patrimônio/fluxo inválido ou retorno extremo', () => {
    const anchor = { totalEquity: 1_000, quotaPrice: 110 };
    expect(computeLiveQuota(anchor, NaN, 0)).toBe(110);
    expect(computeLiveQuota(anchor, -1, 0)).toBe(110);
    expect(computeLiveQuota(anchor, 2_000, 0)).toBe(110); // +100%: circuit breaker live
    expect(computeLiveQuota(anchor, 200, 0)).toBe(110); // -80%: circuit breaker live
  });

  it('aporte tardio grande não se transforma em rentabilidade', () => {
    const anchor = { totalEquity: 4_046.69, quotaPrice: 101.2 };
    const contribution = 16_800;
    expect(computeLiveQuota(anchor, anchor.totalEquity + contribution, contribution))
      .toBeCloseTo(anchor.quotaPrice, 8);
  });
});
