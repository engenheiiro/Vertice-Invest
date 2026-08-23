/**
 * Histerese da lista âncora (estratégia BUY_AND_HOLD). Função PURA — sem I/O.
 *
 * Ver ANCHOR_HYSTERESIS em config/buyAndHoldPublication.js para o porquê:
 * resumidamente, o limiar único de 70 fazia a lista trocar de composição por um
 * ponto de score, e a tese âncora não sobrevive a isso.
 *
 * Contrato:
 *  - entra em COMPRAR com score >= entryScore;
 *  - permanece em COMPRAR enquanto score >= holdScore;
 *  - a folga vale SÓ para o limiar de score. Um travamento substantivo
 *    (preço acima do justo, distribuição não coberta, teto de composição, saída
 *    do portão) derruba o COMPRAR na hora, porque é fato novo sobre o ativo e
 *    não ruído de medição.
 *
 * MOTIVO DE SAÍDA é obrigatório: todo ticker que estava em COMPRAR na publicação
 * anterior e não está mais sai com um texto legível dizendo por quê — inclusive
 * quando ele desaparece do ranking inteiro por ter perdido o portão. Uma âncora
 * que some sem explicação é pior que uma que fica: o assinante montou posição
 * com base nela.
 */

import { ANCHOR_HYSTERESIS } from '../config/buyAndHoldPublication.js';

/** Como o item chegou ao COMPRAR (ou por que não chegou). */
export const HYSTERESIS_STATES = Object.freeze({
  ENTERED: 'ENTERED', // cruzou o limiar de entrada nesta apuração
  MAINTAINED: 'MAINTAINED', // já estava em COMPRAR e segue acima do limiar de entrada
  HELD: 'HELD', // abaixo da entrada, mantido pela banda de permanência
  OUT: 'OUT', // não está em COMPRAR
});

const upper = ticker => String(ticker || '').trim().toUpperCase();

/**
 * @param {object} params
 * @param {Array} params.current  itens do ranking desta apuração, normalizados:
 *   `{ ticker, name, score, action, reason, blocked, blockReason }`.
 *   `blocked` marca AGUARDAR por motivo que não é o limiar de score; quem
 *   preenche é o adaptador de cada classe (é ele que conhece os campos do motor).
 * @param {Array|null} params.previous  itens da publicação ANTERIOR da mesma
 *   estratégia e classe (`{ ticker, action }`). `null` = primeira publicação.
 * @param {Map|object} [params.gateFailuresByTicker]  motivos de portão dos
 *   excluídos desta apuração, para explicar quem sumiu do ranking.
 * @param {object} [params.config]
 * @returns {{ ranking: Array, exits: Array, bootstrap: boolean, counts: object }}
 */
export const applyAnchorHysteresis = ({
  current = [],
  previous = null,
  gateFailuresByTicker = new Map(),
  config = ANCHOR_HYSTERESIS,
} = {}) => {
  const bootstrap = previous === null || previous === undefined;
  const { entryScore, holdScore } = config;

  const previousBuy = new Set(
    (previous || [])
      .filter(item => item?.action === 'BUY')
      .map(item => upper(item.ticker)),
  );
  const previousScore = new Map(
    (previous || []).map(item => [upper(item.ticker), Number(item.score)]),
  );

  const failures = gateFailuresByTicker instanceof Map
    ? gateFailuresByTicker
    : new Map(Object.entries(gateFailuresByTicker || {}));

  const exits = [];
  const seen = new Set();

  const ranking = current.map((item) => {
    const ticker = upper(item.ticker);
    seen.add(ticker);
    const score = Number(item.score) || 0;
    const wasBuy = previousBuy.has(ticker);

    // Caminho normal: o motor já disse COMPRAR. A histerese não interfere.
    if (item.action === 'BUY') {
      return {
        ...item,
        action: 'BUY',
        hysteresis: {
          state: wasBuy ? HYSTERESIS_STATES.MAINTAINED : HYSTERESIS_STATES.ENTERED,
          entryScore,
          holdScore,
          previousScore: previousScore.get(ticker) ?? null,
        },
      };
    }

    // Banda de permanência: só o limiar de score cede, e só para quem já estava.
    if (wasBuy && !item.blocked && score >= holdScore) {
      return {
        ...item,
        action: 'BUY',
        hysteresis: {
          state: HYSTERESIS_STATES.HELD,
          entryScore,
          holdScore,
          previousScore: previousScore.get(ticker) ?? null,
        },
        reason: `${item.reason} · Mantido na lista: score ${score} segue acima do piso de permanência (${holdScore}); `
          + `âncora publicada só sai abaixo dele`,
      };
    }

    const exitReason = wasBuy ? describeExit({ item, score, holdScore }) : null;
    if (wasBuy) {
      exits.push({
        ticker,
        name: item.name || null,
        reason: exitReason,
        score,
        previousScore: previousScore.get(ticker) ?? null,
        stillListed: true,
      });
    }

    return {
      ...item,
      action: 'WAIT',
      hysteresis: {
        state: HYSTERESIS_STATES.OUT,
        entryScore,
        holdScore,
        previousScore: previousScore.get(ticker) ?? null,
      },
      ...(exitReason ? { exitReason } : {}),
    };
  });

  // Quem estava em COMPRAR e sumiu do ranking inteiro (perdeu o portão, ou o
  // ativo saiu da base). Este é o caso que mais precisa de motivo escrito:
  // o ticker simplesmente não aparece mais na tela.
  for (const ticker of previousBuy) {
    if (seen.has(ticker)) continue;
    const gateFailures = failures.get(ticker);
    exits.push({
      ticker,
      name: null,
      reason: gateFailures?.length
        ? `Saiu do universo âncora: ${gateFailures.join('; ')}`
        : 'Saiu do universo âncora: não apareceu entre os ativos avaliados nesta apuração',
      score: null,
      previousScore: previousScore.get(ticker) ?? null,
      stillListed: false,
    });
  }

  return {
    ranking,
    exits,
    bootstrap,
    counts: {
      buy: ranking.filter(item => item.action === 'BUY').length,
      held: ranking.filter(item => item.hysteresis?.state === HYSTERESIS_STATES.HELD).length,
      entered: ranking.filter(item => item.hysteresis?.state === HYSTERESIS_STATES.ENTERED).length,
      exits: exits.length,
    },
  };
};

/** Texto de saída, na ordem em que os motivos se sobrepõem. */
const describeExit = ({ item, score, holdScore }) => {
  if (item.blocked) {
    return item.blockReason
      ? `Saiu da lista: ${item.blockReason}`
      : 'Saiu da lista: deixou de atender a um critério da estratégia âncora';
  }
  return `Saiu da lista: score caiu para ${score}, abaixo do piso de permanência (${holdScore})`;
};

/** Só os COMPRAR — o formato que a próxima apuração precisa como `previous`. */
export const toHysteresisBaseline = (ranking = []) => ranking
  .map(item => ({ ticker: upper(item.ticker), action: item.action, score: Number(item.score) || 0 }))
  .filter(item => item.ticker);
