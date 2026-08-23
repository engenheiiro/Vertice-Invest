/**
 * HISTERESE da lista âncora (estratégia BUY_AND_HOLD).
 *
 * O caso que originou a regra: em 22/08/2026 o BRSR6 caiu de 70 para 69 entre
 * duas rodadas da mesma sessão e trocou de COMPRAR para AGUARDAR. Um ponto de
 * score. Uma lista que se propõe a ser carregada por décadas não pode girar
 * assim — é o defeito V-01 do estudo de maturidade (34 tickers distintos em 40
 * publicações do Brasil 10 em 90 dias) reencenado numa lista âncora.
 */
import { describe, expect, it } from 'vitest';

import { applyAnchorHysteresis, toHysteresisBaseline, HYSTERESIS_STATES } from '../utils/anchorHysteresis.js';
import { ANCHOR_HYSTERESIS } from '../config/buyAndHoldPublication.js';

const item = (over = {}) => ({
  ticker: 'AAAA3',
  name: 'Ativo A',
  score: 70,
  action: 'BUY',
  reason: 'Âncora segura com preço justo',
  blocked: false,
  blockReason: null,
  ...over,
});

const byTicker = (ranking, ticker) => ranking.find(row => row.ticker === ticker);

describe('histerese — banda de permanência', () => {
  it('MANTÉM em COMPRAR o ativo publicado que caiu para 65 (dentro da banda)', () => {
    const { ranking, exits } = applyAnchorHysteresis({
      current: [item({ ticker: 'BRSR6', score: 65, action: 'WAIT', reason: 'Âncora, mas convicção insuficiente' })],
      previous: [{ ticker: 'BRSR6', action: 'BUY', score: 70 }],
    });

    expect(byTicker(ranking, 'BRSR6').action).toBe('BUY');
    expect(byTicker(ranking, 'BRSR6').hysteresis.state).toBe(HYSTERESIS_STATES.HELD);
    expect(byTicker(ranking, 'BRSR6').reason).toContain('piso de permanência');
    expect(exits).toHaveLength(0);
  });

  it('NÃO deixa entrar o ativo novo com 65 — a banda vale só para quem já está', () => {
    const { ranking, exits } = applyAnchorHysteresis({
      current: [item({ ticker: 'NOVA3', score: 65, action: 'WAIT', reason: 'Âncora, mas convicção insuficiente' })],
      previous: [{ ticker: 'OUTRO3', action: 'BUY', score: 80 }],
    });

    expect(byTicker(ranking, 'NOVA3').action).toBe('WAIT');
    expect(byTicker(ranking, 'NOVA3').hysteresis.state).toBe(HYSTERESIS_STATES.OUT);
    // OUTRO3 sumiu do universo: sai, e com motivo.
    expect(exits.map(exit => exit.ticker)).toEqual(['OUTRO3']);
  });

  it('SAI com motivo preenchido o ativo publicado que caiu para 61 (abaixo da banda)', () => {
    const { ranking, exits } = applyAnchorHysteresis({
      current: [item({ ticker: 'CAIU4', score: 61, action: 'WAIT', reason: 'Âncora, mas convicção insuficiente' })],
      previous: [{ ticker: 'CAIU4', action: 'BUY', score: 72 }],
    });

    expect(byTicker(ranking, 'CAIU4').action).toBe('WAIT');
    expect(byTicker(ranking, 'CAIU4').exitReason).toContain('61');
    expect(byTicker(ranking, 'CAIU4').exitReason).toContain(String(ANCHOR_HYSTERESIS.holdScore));
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ ticker: 'CAIU4', previousScore: 72, score: 61, stillListed: true });
    expect(exits[0].reason.length).toBeGreaterThan(0);
  });

  it('marca as fronteiras exatas: 70 entra, 69 não entra, 62 permanece, 61 sai', () => {
    const { entryScore, holdScore } = ANCHOR_HYSTERESIS;
    expect(entryScore).toBe(70);
    expect(holdScore).toBe(62);

    const run = (score, wasBuy, action) => applyAnchorHysteresis({
      current: [item({ ticker: 'XXXX3', score, action, reason: 'motivo' })],
      previous: wasBuy ? [{ ticker: 'XXXX3', action: 'BUY', score: 75 }] : [],
    }).ranking[0].action;

    expect(run(70, false, 'BUY')).toBe('BUY'); // entra no limiar
    expect(run(69, false, 'WAIT')).toBe('WAIT'); // não entra um ponto abaixo
    expect(run(62, true, 'WAIT')).toBe('BUY'); // permanece no piso
    expect(run(61, true, 'WAIT')).toBe('WAIT'); // sai um ponto abaixo do piso
  });
});

describe('histerese — o que ela NÃO segura', () => {
  it('não mantém em COMPRAR quem foi travado por preço, mesmo dentro da banda', () => {
    const { ranking, exits } = applyAnchorHysteresis({
      current: [item({
        ticker: 'CARA3',
        score: 68,
        action: 'WAIT',
        blocked: true,
        blockReason: 'preço subiu acima do valor justo',
        reason: 'Âncora segura, porém cara — aguarde preço',
      })],
      previous: [{ ticker: 'CARA3', action: 'BUY', score: 74 }],
    });

    expect(byTicker(ranking, 'CARA3').action).toBe('WAIT');
    expect(exits[0].reason).toContain('preço subiu acima do valor justo');
  });

  it('não mantém em COMPRAR o FII cuja distribuição deixou de ser coberta pelo FFO', () => {
    const { exits } = applyAnchorHysteresis({
      current: [item({
        ticker: 'XPXX11',
        score: 69,
        action: 'WAIT',
        blocked: true,
        blockReason: 'distribuição deixou de ser coberta pelo FFO',
        reason: 'Distribuição não coberta pelo FFO',
      })],
      previous: [{ ticker: 'XPXX11', action: 'BUY', score: 71 }],
    });

    expect(exits[0].reason).toContain('FFO');
  });
});

describe('histerese — motivo de saída é obrigatório', () => {
  it('explica quem SUMIU do ranking inteiro usando o motivo de portão', () => {
    const { exits } = applyAnchorHysteresis({
      current: [item({ ticker: 'FICOU3' })],
      previous: [
        { ticker: 'FICOU3', action: 'BUY', score: 80 },
        { ticker: 'SUMIU4', action: 'BUY', score: 73 },
      ],
      gateFailuresByTicker: new Map([['SUMIU4', ['beta acima de 1', 'ROE abaixo de 10']]]),
    });

    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ ticker: 'SUMIU4', stillListed: false, previousScore: 73 });
    expect(exits[0].reason).toContain('beta acima de 1');
    expect(exits[0].reason).toContain('ROE abaixo de 10');
  });

  it('ainda assim explica quem sumiu sem motivo de portão conhecido', () => {
    const { exits } = applyAnchorHysteresis({
      current: [],
      previous: [{ ticker: 'FANTASMA3', action: 'BUY', score: 70 }],
    });

    expect(exits[0].reason).toMatch(/Saiu do universo âncora/);
    expect(exits[0].reason.length).toBeGreaterThan(20);
  });

  it('todo ativo que deixa a lista carrega um motivo — nenhum sai em silêncio', () => {
    const { ranking, exits } = applyAnchorHysteresis({
      current: [
        item({ ticker: 'A1', score: 61, action: 'WAIT', reason: 'r' }),
        item({ ticker: 'B2', score: 66, action: 'WAIT', blocked: true, blockReason: 'preço', reason: 'r' }),
        item({ ticker: 'C3', score: 80, action: 'BUY' }),
      ],
      previous: [
        { ticker: 'A1', action: 'BUY', score: 71 },
        { ticker: 'B2', action: 'BUY', score: 72 },
        { ticker: 'C3', action: 'BUY', score: 79 },
        { ticker: 'D4', action: 'BUY', score: 70 },
      ],
    });

    expect(exits).toHaveLength(3);
    for (const exit of exits) expect(String(exit.reason || '').trim()).not.toBe('');
    // Quem continua listado também leva o motivo no próprio item.
    for (const row of ranking.filter(r => r.action === 'WAIT')) {
      expect(String(row.exitReason || '').trim()).not.toBe('');
    }
  });

  it('não inventa saída para quem já estava em AGUARDAR na publicação anterior', () => {
    const { exits } = applyAnchorHysteresis({
      current: [item({ ticker: 'ESPERA3', score: 50, action: 'WAIT', reason: 'r' })],
      previous: [{ ticker: 'ESPERA3', action: 'WAIT', score: 52 }],
    });
    expect(exits).toHaveLength(0);
  });
});

describe('histerese — bootstrap', () => {
  it('sem publicação anterior, vale o limiar de ENTRADA e não há saídas', () => {
    const result = applyAnchorHysteresis({
      current: [
        item({ ticker: 'ALTO3', score: 74, action: 'BUY' }),
        item({ ticker: 'MEIO4', score: 65, action: 'WAIT', reason: 'r' }),
      ],
      previous: null,
    });

    expect(result.bootstrap).toBe(true);
    expect(byTicker(result.ranking, 'ALTO3').action).toBe('BUY');
    expect(byTicker(result.ranking, 'ALTO3').hysteresis.state).toBe(HYSTERESIS_STATES.ENTERED);
    // 65 está DENTRO da banda, mas não há lista anterior para pertencer.
    expect(byTicker(result.ranking, 'MEIO4').action).toBe('WAIT');
    expect(result.exits).toHaveLength(0);
  });

  it('lista anterior vazia se comporta como bootstrap para quem tenta entrar', () => {
    const result = applyAnchorHysteresis({
      current: [item({ ticker: 'MEIO4', score: 65, action: 'WAIT', reason: 'r' })],
      previous: [],
    });
    expect(result.bootstrap).toBe(false);
    expect(result.ranking[0].action).toBe('WAIT');
    expect(result.exits).toHaveLength(0);
  });
});

describe('baseline de histerese', () => {
  it('normaliza ticker e preserva a action, que é o que a próxima rodada compara', () => {
    const baseline = toHysteresisBaseline([
      { ticker: 'petr4', action: 'BUY', score: 71 },
      { ticker: ' TAEE11 ', action: 'WAIT', score: 55 },
    ]);
    expect(baseline).toEqual([
      { ticker: 'PETR4', action: 'BUY', score: 71 },
      { ticker: 'TAEE11', action: 'WAIT', score: 55 },
    ]);
  });
});
