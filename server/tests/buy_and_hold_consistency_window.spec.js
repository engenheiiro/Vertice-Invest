/**
 * Janela de medição do drawdown (eixo de consistência do motor âncora de ações).
 *
 * O eixo de consistência é comparado entre ativos numa lista única, então o
 * drawdown de cada um precisa vir da MESMA janela. Medindo a série inteira, o
 * número respondia "quem tem série mais longa" em vez de "quem caiu mais": em
 * 22/08/2026 só 4 dos 362 documentos de STOCK escaparam do cap de 400 candles do
 * timeSeriesWorker, e dois deles (ITSA4, CMIG4) estão no universo âncora — a
 * janela extra alcançava março/2020 e cobrava deles um crash que a janela dos
 * pares nem enxergava.
 */
import { describe, expect, it } from 'vitest';
import { maxDrawdownPct } from '../services/buyAndHoldService.js';
import { BUY_AND_HOLD_CONFIG } from '../config/buyAndHold.js';

const { drawdownWindowCandles, drawdownMinCandles } = BUY_AND_HOLD_CONFIG.consistency;

/** Série sintética: `n` candles em 100, com um vale de `troughPct` no índice `at`. */
const series = (n, { at, troughPct = 0 } = {}) => Array.from({ length: n }, (_, i) => ({
  close: i === at ? 100 * (1 - troughPct / 100) : 100,
}));

describe('janela comum do drawdown', () => {
  it('crash fora da janela não conta — série longa não é punida por ser longa', () => {
    // Crash de 50% no começo de uma série 4x mais funda que a janela.
    const funda = series(drawdownWindowCandles * 4, { at: 10, troughPct: 50 });
    expect(maxDrawdownPct(funda)).toBe(0);
  });

  it('queda DENTRO da janela conta integralmente', () => {
    const dentro = series(drawdownWindowCandles * 4, { at: drawdownWindowCandles * 4 - 5, troughPct: 30 });
    expect(maxDrawdownPct(dentro)).toBe(30);
  });

  it('dois ativos com a mesma queda recente empatam, independente da profundidade', () => {
    const curta = series(drawdownWindowCandles, { at: drawdownWindowCandles - 3, troughPct: 20 });
    const longa = series(drawdownWindowCandles * 4, { at: drawdownWindowCandles * 4 - 3, troughPct: 20 });
    expect(maxDrawdownPct(curta)).toBe(maxDrawdownPct(longa));
  });

  it('série curta demais vira AUSENTE (null), nunca nota — ausência não é drawdown baixo', () => {
    const rasa = series(drawdownMinCandles - 1, { at: 5, troughPct: 2 });
    expect(maxDrawdownPct(rasa)).toBeNull();
    expect(maxDrawdownPct([])).toBeNull();
    expect(maxDrawdownPct(null)).toBeNull();
  });

  it('cobertura no limite do piso é medida normalmente', () => {
    const noLimite = series(drawdownMinCandles, { at: drawdownMinCandles - 2, troughPct: 12 });
    expect(maxDrawdownPct(noLimite)).toBe(12);
  });

  it('a janela sai da config, não de número mágico no serviço', () => {
    const cfg = { consistency: { drawdownWindowCandles: 10, drawdownMinCandles: 5 } };
    const s = series(40, { at: 0, troughPct: 60 });
    expect(maxDrawdownPct(s, cfg)).toBe(0); // crash no índice 0 está fora dos últimos 10
    // Mesma série na config real: 40 candles não cobrem o piso, então é AUSENTE.
    expect(maxDrawdownPct(s)).toBeNull();
  });
});
