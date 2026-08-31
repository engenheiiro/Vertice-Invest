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
import { dropUntradableCandles, isStorableCandleDate, mergeCandleSeries } from '../utils/assetHistory.js';
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

/**
 * Candle em dia SEM PREGÃO — o defeito de domingo 30/08/2026.
 *
 * A fonte devolveu, para 18 FIIs ilíquidos, uma linha datada num DOMINGO
 * repetindo o preço de quinta. O dano não é o preço errado: `isHistoryStale` só
 * olha a DATA do último candle, então a série passou a parecer fresquíssima e o
 * worker nunca mais buscou nada — congelada num preço falso, sem cura espontânea.
 */
describe('isStorableCandleDate', () => {
  // 2026-08-30 = domingo · 2026-08-29 = sábado · 2026-08-28 = sexta
  const AGORA = new Date('2026-08-31T12:00:00.000Z');

  it('recusa fim de semana nas classes de pregão seg–sex', () => {
    for (const type of ['STOCK', 'STOCK_US', 'FII', 'ETF', 'REIT', 'INDEX']) {
      expect(isStorableCandleDate('2026-08-30', type, AGORA)).toBe(false); // domingo
      expect(isStorableCandleDate('2026-08-29', type, AGORA)).toBe(false); // sábado
      expect(isStorableCandleDate('2026-08-28', type, AGORA)).toBe(true);  // sexta
    }
  });

  it('cripto negocia 24/7 — fim de semana é candle legítimo', () => {
    expect(isStorableCandleDate('2026-08-30', 'CRYPTO', AGORA)).toBe(true);
    expect(isStorableCandleDate('2026-08-29', 'CRYPTO', AGORA)).toBe(true);
  });

  it('sem classe informada não filtra dia — o câmbio abre domingo à noite', () => {
    expect(isStorableCandleDate('2026-08-30', undefined, AGORA)).toBe(true);
    expect(isStorableCandleDate('2026-08-30', 'CURRENCY', AGORA)).toBe(true);
  });

  it('feriado NÃO é critério: a B3 e a NYSE não fecham nos mesmos dias', () => {
    // 07/09/2026 (segunda) é feriado no Brasil e pregão normal nos EUA. Recusar
    // pelo calendário brasileiro apagaria um pregão real do STOCK_US.
    const setembro = new Date('2026-09-30T12:00:00.000Z');
    expect(isStorableCandleDate('2026-09-07', 'STOCK_US', setembro)).toBe(true);
    expect(isStorableCandleDate('2026-09-07', 'STOCK', setembro)).toBe(true);
  });

  it('recusa data absurda no futuro, mas tolera o fuso da fonte (D+1)', () => {
    // Os candles de cripto vêm datados em UTC: entre 21h e meia-noite de Brasília
    // o dia UTC já virou, e cortar em "hoje" recusaria o candle do dia corrente.
    expect(isStorableCandleDate('2026-09-01', 'CRYPTO', AGORA)).toBe(true);
    expect(isStorableCandleDate('2026-09-02', 'CRYPTO', AGORA)).toBe(false);
    expect(isStorableCandleDate('2027-01-04', 'STOCK', AGORA)).toBe(false);
  });

  it('data malformada não é candle', () => {
    expect(isStorableCandleDate('', 'STOCK', AGORA)).toBe(false);
    expect(isStorableCandleDate(undefined, 'STOCK', AGORA)).toBe(false);
    expect(isStorableCandleDate('30/08/2026', 'STOCK', AGORA)).toBe(false);
  });
});

describe('mergeCandleSeries — dia sem pregão', () => {
  const AGORA = new Date('2026-08-31T12:00:00.000Z');
  const opts = (type) => ({ maxPoints: CAP, type, now: AGORA });

  it('candle de domingo vindo da fonte NÃO entra — o caso AERO11', () => {
    const guardada = [candle('2026-08-26', 100), candle('2026-08-27', 100)];
    const fonte = [candle('2026-08-30', 100)]; // domingo
    const merged = mergeCandleSeries(guardada, fonte, opts('FII'));
    expect(merged.map(c => c.date)).toEqual(['2026-08-26', '2026-08-27']);
  });

  it('candle de domingo JÁ GUARDADO sai na próxima gravação', () => {
    const envenenada = [candle('2026-08-27', 100), candle('2026-08-30', 100)];
    const merged = mergeCandleSeries(envenenada, [candle('2026-08-31', 101)], opts('FII'));
    expect(merged.map(c => c.date)).toEqual(['2026-08-27', '2026-08-31']);
  });

  it('sem type o comportamento antigo é preservado', () => {
    const merged = mergeCandleSeries(
      [candle('2026-08-27', 100)], [candle('2026-08-30', 100)], { maxPoints: CAP });
    expect(merged.map(c => c.date)).toEqual(['2026-08-27', '2026-08-30']);
  });

  it('cripto mantém o fim de semana', () => {
    const merged = mergeCandleSeries(
      [candle('2026-08-28', 10)], [candle('2026-08-29', 11), candle('2026-08-30', 12)], opts('CRYPTO'));
    expect(merged.map(c => c.date)).toEqual(['2026-08-28', '2026-08-29', '2026-08-30']);
  });

  // `serie()` anda em dias CORRIDOS e por isso cai em fim de semana — o que a
  // guarda passa a recusar. Aqui a série guardada precisa ser de pregões.
  const serieUteis = (n) => {
    const out = [];
    const d = new Date(Date.UTC(2020, 0, 1));
    while (out.length < n) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) out.push(candle(d.toISOString().slice(0, 10), 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  };

  it('a catraca conta a série guardada JÁ FILTRADA', () => {
    // Série profunda com um candle inválido: a profundidade preservada é a dos
    // candles válidos, não a contagem inflada pelo que acabou de ser recusado.
    const profunda = [...serieUteis(500), candle('2026-08-30', 9)];
    const merged = mergeCandleSeries(profunda, [], opts('STOCK'));
    expect(merged.length).toBe(500);
    expect(merged.some(c => c.date === '2026-08-30')).toBe(false);
  });
});

describe('dropUntradableCandles', () => {
  it('filtra a série sem depender da mescla (caminho do financialService)', () => {
    const bruta = [candle('2026-08-28', 10), candle('2026-08-30', 10)];
    expect(dropUntradableCandles(bruta, 'STOCK', new Date('2026-08-31T12:00:00.000Z'))
      .map(c => c.date)).toEqual(['2026-08-28']);
  });

  it('entrada nula devolve lista vazia', () => {
    expect(dropUntradableCandles(null, 'STOCK')).toEqual([]);
    expect(dropUntradableCandles(undefined, 'STOCK')).toEqual([]);
  });
});
