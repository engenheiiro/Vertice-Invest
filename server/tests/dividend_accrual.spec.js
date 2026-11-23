import { describe, expect, it } from 'vitest';
import { accrueDividendLedger, emptyDividendAccrual } from '../utils/dividendAccrual.js';

const at = (d) => new Date(`${d}T12:00:00.000Z`);

describe('accrueDividendLedger — acumulado por ex-date', () => {
  it('credita pela posição de antes do dia-ex e separa pago, pendente e janela since', () => {
    const txs = [
      { ticker: 'PETR4', type: 'BUY', quantity: 10, date: at('2026-01-05') },
      { ticker: 'PETR4', type: 'BUY', quantity: 10, date: at('2026-02-10') },
    ];
    const map = new Map([
      ['2026-02-10', [{ ticker: 'PETR4', amount: 1, paymentDate: at('2026-02-20') }]],
      ['2026-03-10', [{ ticker: 'PETR4', amount: 0.5 }]],
      ['2026-05-01', [{ ticker: 'PETR4', amount: 9 }]],
    ]);
    const r = accrueDividendLedger(txs, map, () => 1, { throughDayKey: '2026-03-20', sinceDayKey: '2026-03-01' });
    // 10 × 1 no dia-ex (a compra do próprio dia não recebe) + 20 × 0,5 depois.
    expect(r).toEqual({ total: 20, paid: 10, pending: 10, byTicker: { PETR4: 20 }, sinceTotal: 10, sinceByTicker: { PETR4: 10 } });
  });

  it('aplica o câmbio do provento por ticker e dia', () => {
    const txs = [{ ticker: 'AAPL', type: 'BUY', quantity: 2, date: at('2026-01-05') }];
    const map = new Map([['2026-02-10', [{ ticker: 'AAPL', amount: 0.25 }]]]);
    const r = accrueDividendLedger(txs, map, (t, d) => (t === 'AAPL' && d === '2026-02-10' ? 5.5 : 1), { throughDayKey: '2026-12-31' });
    expect(r.total).toBe(2.75);
  });

  it('posição vendida a zero não recebe', () => {
    const txs = [
      { ticker: 'X', type: 'BUY', quantity: 1, date: at('2026-01-05') },
      { ticker: 'X', type: 'SELL', quantity: 2, date: at('2026-01-06') },
    ];
    const map = new Map([['2026-02-10', [{ ticker: 'X', amount: 1 }]]]);
    expect(accrueDividendLedger(txs, map, () => 1, { throughDayKey: '2026-12-31' }).total).toBe(0);
  });

  it('resultado vazio é um objeto novo a cada chamada', () => {
    const a = emptyDividendAccrual();
    a.byTicker.X = 1;
    expect(emptyDividendAccrual().byTicker).toEqual({});
  });
});
