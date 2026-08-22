/**
 * mergeCandleSeries — gravação de série por MESCLA, nunca por substituição.
 *
 * O timeSeriesWorker gravava `externalHistory.slice(-CAP)`, substituindo a série
 * inteira pelo que a fonte devolvesse. Isso transforma qualquer degradação da
 * fonte em perda permanente de dado nosso: em 22/08/2026 a série do HSRE11 tinha
 * UM candle porque o Yahoo passou a devolver um só (a cópia sob a chave legada
 * `HSRE11.SA` ainda guardava 623). E a série encurtada não se recupera sozinha —
 * `isHistoryStale` só olha a DATA do último candle, então um único candle recente
 * parece uma série em dia.
 */
import { describe, expect, it } from 'vitest';
import { mergeCandleSeries } from '../utils/assetHistory.js';
import { ASSET_HISTORY_MAX_POINTS } from '../config/financialConstants.js';

const candle = (date, close = 10) => ({ date, close, adjClose: close, volume: 100 });
const serie = (n, offset = 0) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2020, 0, 1 + i + offset));
  return candle(d.toISOString().slice(0, 10), 10 + i);
});

const CAP = ASSET_HISTORY_MAX_POINTS;

describe('mergeCandleSeries', () => {
  it('fonte degradada NÃO apaga a série guardada — o caso HSRE11', () => {
    const guardada = serie(623);
    const fonteQuebrada = [candle('2026-07-24', 9.9)];
    const merged = mergeCandleSeries(guardada, fonteQuebrada, { maxPoints: CAP });
    // Antes: a série virava [1 candle]. Agora a profundidade é mantida (a catraca
    // segura em 623, a janela apenas anda) e o candle da fonte entra.
    expect(merged.length).toBe(623);
    expect(merged.some(c => c.date === '2026-07-24')).toBe(true);
  });

  it('candle novo da fonte entra e vence em data repetida', () => {
    const guardada = [candle('2026-08-20', 10), candle('2026-08-21', 11)];
    const nova = [candle('2026-08-21', 99), candle('2026-08-22', 12)];
    const merged = mergeCandleSeries(guardada, nova, { maxPoints: CAP });
    expect(merged.map(c => c.date)).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
    expect(merged.find(c => c.date === '2026-08-21').close).toBe(99);
  });

  it('devolve oldest→newest mesmo com entrada fora de ordem', () => {
    const merged = mergeCandleSeries(
      [candle('2026-08-21'), candle('2026-08-19')],
      [candle('2026-08-20')],
      { maxPoints: CAP },
    );
    expect(merged.map(c => c.date)).toEqual(['2026-08-19', '2026-08-20', '2026-08-21']);
  });

  it('o cap governa série nova, mas não encurta série já profunda', () => {
    // Catraca: o teto passa a ser o tamanho já guardado. A série anda para a
    // frente mantendo a profundidade — nunca desaba para o cap, que é o que a
    // gravação por substituição fazia a cada re-busca.
    const profunda = serie(1653);
    const merged = mergeCandleSeries(profunda, serie(400, 1653), { maxPoints: CAP });
    expect(merged.length).toBe(1653);
    expect(merged.length).toBeGreaterThan(CAP);
    expect(merged[merged.length - 1].date).toBe(serie(400, 1653)[399].date);

    // Já uma série nova é cortada no cap.
    const nova = mergeCandleSeries([], serie(1653), { maxPoints: CAP });
    expect(nova.length).toBe(CAP);
  });

  it('isento de cap guarda tudo', () => {
    const merged = mergeCandleSeries([], serie(1653), { maxPoints: Infinity });
    expect(merged.length).toBe(1653);
  });

  it('candle da fonte com close <= 0 é dia sem dado, não preço zero', () => {
    const merged = mergeCandleSeries(
      [candle('2026-08-20', 10)],
      [{ date: '2026-08-21', close: 0 }, { date: '2026-08-22', close: -1 }, candle('2026-08-23', 11)],
      { maxPoints: CAP },
    );
    expect(merged.map(c => c.date)).toEqual(['2026-08-20', '2026-08-23']);
  });

  it('preserva candle guardado que a fonte não serve mais', () => {
    const guardada = [candle('2020-01-02', 5), candle('2026-08-21', 10)];
    const merged = mergeCandleSeries(guardada, [candle('2026-08-22', 11)], { maxPoints: CAP });
    expect(merged[0].date).toBe('2020-01-02');
  });

  it('normaliza adjClose ausente e volume ausente sem inventar preço', () => {
    const merged = mergeCandleSeries([], [{ date: '2026-08-21', close: 7 }], { maxPoints: CAP });
    expect(merged[0]).toEqual({ date: '2026-08-21', close: 7, adjClose: 7, volume: 0 });
  });

  it('entradas vazias não quebram', () => {
    expect(mergeCandleSeries([], [], { maxPoints: CAP })).toEqual([]);
    expect(mergeCandleSeries(undefined, undefined, { maxPoints: CAP })).toEqual([]);
  });
});
