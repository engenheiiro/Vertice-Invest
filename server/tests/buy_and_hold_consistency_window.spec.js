/**
 * Janela de medição do drawdown (eixo de consistência dos motores âncora).
 *
 * O eixo de consistência é comparado entre ativos numa lista única, então o
 * drawdown de cada um precisa vir da MESMA janela. Medindo a série inteira, o
 * número respondia "quem tem série mais longa" em vez de "quem caiu mais" — e a
 * desigualdade de profundidade no banco é permanente, não uma fila que se
 * esvazia: a catraca de walletDayCandleService mantém funda a série de todo
 * ticker em carteira (medição de 22/08/2026: os 14 de renda variável em
 * carteira, sem exceção, contra 400 candles do resto).
 */
import { describe, expect, it } from 'vitest';
import { maxDrawdownPct } from '../utils/assetHistory.js';
import { BUY_AND_HOLD_CONFIG } from '../config/buyAndHold.js';
import { FII_BUY_AND_HOLD_CONFIG } from '../config/fiiBuyAndHold.js';

const acoes = BUY_AND_HOLD_CONFIG.consistency;
const { drawdownWindowCandles, drawdownMinCandles } = acoes;

/** Série sintética: `n` candles em 100, com um vale de `troughPct` no índice `at`. */
const series = (n, { at, troughPct = 0 } = {}) => Array.from({ length: n }, (_, i) => ({
  close: i === at ? 100 * (1 - troughPct / 100) : 100,
}));

describe('janela comum do drawdown', () => {
  it('crash fora da janela não conta — série longa não é punida por ser longa', () => {
    // Crash de 50% no começo de uma série 4x mais funda que a janela.
    const funda = series(drawdownWindowCandles * 4, { at: 10, troughPct: 50 });
    expect(maxDrawdownPct(funda, acoes)).toBe(0);
  });

  it('queda DENTRO da janela conta integralmente', () => {
    const dentro = series(drawdownWindowCandles * 4, { at: drawdownWindowCandles * 4 - 5, troughPct: 30 });
    expect(maxDrawdownPct(dentro, acoes)).toBe(30);
  });

  it('dois ativos com a mesma queda recente empatam, independente da profundidade', () => {
    const curta = series(drawdownWindowCandles, { at: drawdownWindowCandles - 3, troughPct: 20 });
    const longa = series(drawdownWindowCandles * 4, { at: drawdownWindowCandles * 4 - 3, troughPct: 20 });
    expect(maxDrawdownPct(curta, acoes)).toBe(maxDrawdownPct(longa, acoes));
  });

  it('série curta demais vira AUSENTE (null), nunca nota — ausência não é drawdown baixo', () => {
    const rasa = series(drawdownMinCandles - 1, { at: 5, troughPct: 2 });
    expect(maxDrawdownPct(rasa, acoes)).toBeNull();
    expect(maxDrawdownPct([], acoes)).toBeNull();
    expect(maxDrawdownPct(null, acoes)).toBeNull();
  });

  it('cobertura no limite do piso é medida normalmente', () => {
    const noLimite = series(drawdownMinCandles, { at: drawdownMinCandles - 2, troughPct: 12 });
    expect(maxDrawdownPct(noLimite, acoes)).toBe(12);
  });

  it('sem opções de janela o resultado é AUSENTE, nunca um número de janela errada', () => {
    // Fail-closed: config faltando não pode virar "drawdown da série inteira".
    const s = series(drawdownWindowCandles * 4, { at: 10, troughPct: 50 });
    expect(maxDrawdownPct(s)).toBeNull();
    expect(maxDrawdownPct(s, {})).toBeNull();
  });

  it('a janela sai da config, não de número mágico no util', () => {
    const cfg = { drawdownWindowCandles: 10, drawdownMinCandles: 5 };
    const s = series(40, { at: 0, troughPct: 60 });
    expect(maxDrawdownPct(s, cfg)).toBe(0); // crash no índice 0 está fora dos últimos 10
    // Mesma série na config de ações: 40 candles não cobrem o piso, então é AUSENTE.
    expect(maxDrawdownPct(s, acoes)).toBeNull();
  });
});

describe('ações e FIIs medem o drawdown na mesma janela', () => {
  it('as duas configs declaram janela e piso', () => {
    for (const cfg of [BUY_AND_HOLD_CONFIG.consistency, FII_BUY_AND_HOLD_CONFIG.consistency]) {
      expect(Number.isFinite(cfg.drawdownWindowCandles)).toBe(true);
      expect(Number.isFinite(cfg.drawdownMinCandles)).toBe(true);
      expect(cfg.drawdownMinCandles).toBeLessThanOrEqual(cfg.drawdownWindowCandles);
    }
  });

  it('a mesma série dá o mesmo drawdown nos dois motores', () => {
    // Se as janelas divergirem, um FII e uma ação com a mesma queda passam a
    // receber notas de consistência diferentes — e nenhuma leitura do produto
    // explica isso ao usuário.
    const s = series(2000, { at: 100, troughPct: 40 });
    expect(maxDrawdownPct(s, FII_BUY_AND_HOLD_CONFIG.consistency))
      .toBe(maxDrawdownPct(s, BUY_AND_HOLD_CONFIG.consistency));
  });
});
