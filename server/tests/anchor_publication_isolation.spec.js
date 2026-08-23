/**
 * ISOLAMENTO entre a estratégia âncora (`BUY_AND_HOLD`) e a legada (`BUY_HOLD`).
 *
 * A regra que atravessa o projeto inteiro: publicar a lista âncora não pode
 * afetar o Research semanal em NADA — nem no ponteiro publicado, nem no
 * conteúdo, nem no contrato que valida o ranking dele. As duas convivem porque
 * `PublishedResearchPointer` é único por `(assetClass, strategy, section)`.
 *
 * O contrato de ranking passou a ser PARAMÉTRICO por estratégia. Estes testes
 * existem para que ele não seja "afrouxado" por acidente: a garantia do semanal
 * (`score >= 70 ⇔ BUY`) tem que continuar de pé exatamente como antes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RANKING_CONTRACTS,
  contractForStrategy,
  deriveRankingAction,
  finalizeRanking,
  validateRankingContract,
} from '../utils/rankingContract.js';
import { ANCHOR_HYSTERESIS, ANCHOR_RISK_PROFILE, ANCHOR_STRATEGY } from '../config/buyAndHoldPublication.js';

const mocks = vi.hoisted(() => ({
  bulkWrite: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('../models/PublishedResearchPointer.js', () => ({
  default: { bulkWrite: mocks.bulkWrite },
}));

vi.mock('../utils/dbTransaction.js', () => ({
  runTransaction: mocks.runTransaction,
}));

const { activateResearchSections } = await import('../services/researchPublicationService.js');

const anchorItem = (over = {}) => ({
  ticker: 'CPFE3',
  score: 81,
  action: 'BUY',
  riskProfile: ANCHOR_RISK_PROFILE,
  reason: 'Âncora segura com preço justo',
  anchor: { axes: { durability: 80, resilience: 75, consistency: 60 }, hysteresis: { state: 'ENTERED' } },
  ...over,
});

describe('contrato de ranking — a garantia do SEMANAL não muda', () => {
  it('segue derivando action do score e recusando divergência', () => {
    const items = [
      { ticker: 'AAA3', score: 80, action: 'WAIT', riskProfile: 'DEFENSIVE', position: 1 },
    ];
    // finalizeRanking recalcula a action do semanal, como sempre fez.
    const finalized = finalizeRanking(items);
    expect(finalized[0].action).toBe('BUY');
    expect(validateRankingContract(finalized).ok).toBe(true);

    // E a validação continua recusando um ranking com action incoerente.
    const tampered = [{ ...finalized[0], action: 'WAIT' }];
    const result = validateRankingContract(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('action incoerente com score');
  });

  it('recusa o perfil ANCHOR dentro da estratégia legada', () => {
    const items = [{
      ticker: 'AAA3', score: 80, action: deriveRankingAction(80), riskProfile: ANCHOR_RISK_PROFILE, position: 1,
    }];
    const result = validateRankingContract(items);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('perfil inválido');
  });

  it('o default sem strategy continua sendo o contrato do semanal', () => {
    expect(contractForStrategy(undefined)).toBe(RANKING_CONTRACTS.BUY_HOLD);
    expect(contractForStrategy('QUALQUER_COISA')).toBe(RANKING_CONTRACTS.BUY_HOLD);
  });
});

describe('contrato de ranking — a estratégia âncora tem o seu', () => {
  it('aceita o perfil único ANCHOR e recusa os três perfis do semanal', () => {
    const anchor = finalizeRanking([anchorItem()], null, { strategy: ANCHOR_STRATEGY });
    expect(validateRankingContract(anchor, { strategy: ANCHOR_STRATEGY }).ok).toBe(true);

    const wrongProfile = finalizeRanking([anchorItem({ riskProfile: 'DEFENSIVE' })], null, { strategy: ANCHOR_STRATEGY });
    const result = validateRankingContract(wrongProfile, { strategy: ANCHOR_STRATEGY });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('perfil inválido');
  });

  it('PRESERVA a action do motor — não a deriva do score', () => {
    // Âncora ótima, porém cara: score alto e AGUARDAR é legítimo aqui, e
    // derivar do score (como o semanal faz) apagaria o freio de preço.
    const finalized = finalizeRanking(
      [anchorItem({ score: 88, action: 'WAIT', reason: 'Âncora segura, porém cara — aguarde preço' })],
      null,
      { strategy: ANCHOR_STRATEGY },
    );
    expect(finalized[0].action).toBe('WAIT');
    expect(validateRankingContract(finalized, { strategy: ANCHOR_STRATEGY }).ok).toBe(true);
  });

  it('recusa COMPRAR abaixo do limiar de entrada sem declarar a histerese', () => {
    const finalized = finalizeRanking(
      [anchorItem({ score: 65, action: 'BUY', anchor: { axes: {}, hysteresis: { state: 'ENTERED' } } })],
      null,
      { strategy: ANCHOR_STRATEGY },
    );
    const result = validateRankingContract(finalized, { strategy: ANCHOR_STRATEGY });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('abaixo do limiar de entrada');
  });

  it('aceita COMPRAR na banda de permanência quando a histerese está declarada', () => {
    const finalized = finalizeRanking(
      [anchorItem({ score: 65, action: 'BUY', anchor: { axes: {}, hysteresis: { state: 'HELD' } } })],
      null,
      { strategy: ANCHOR_STRATEGY },
    );
    expect(validateRankingContract(finalized, { strategy: ANCHOR_STRATEGY }).ok).toBe(true);
  });

  it('recusa COMPRAR abaixo do PISO de permanência mesmo com histerese declarada', () => {
    const finalized = finalizeRanking(
      [anchorItem({ score: ANCHOR_HYSTERESIS.holdScore - 1, action: 'BUY', anchor: { axes: {}, hysteresis: { state: 'HELD' } } })],
      null,
      { strategy: ANCHOR_STRATEGY },
    );
    const result = validateRankingContract(finalized, { strategy: ANCHOR_STRATEGY });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('piso de permanência');
  });

  it('recusa AGUARDAR sem motivo escrito — a lista âncora não descarta em silêncio', () => {
    const finalized = finalizeRanking(
      [anchorItem({ score: 50, action: 'WAIT', reason: '   ' })],
      null,
      { strategy: ANCHOR_STRATEGY },
    );
    const result = validateRankingContract(finalized, { strategy: ANCHOR_STRATEGY });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('WAIT sem motivo escrito');
  });

  it('ordena por score e desempata pelos eixos âncora, não por metrics.structural', () => {
    const finalized = finalizeRanking([
      anchorItem({ ticker: 'BAIXO3', score: 70, anchor: { axes: { durability: 50, resilience: 50, consistency: 50 } } }),
      anchorItem({ ticker: 'ALTO3', score: 70, anchor: { axes: { durability: 90, resilience: 90, consistency: 90 } } }),
      anchorItem({ ticker: 'TOPO3', score: 84 }),
    ], null, { strategy: ANCHOR_STRATEGY });

    expect(finalized.map(row => row.ticker)).toEqual(['TOPO3', 'ALTO3', 'BAIXO3']);
    expect(validateRankingContract(finalized, { strategy: ANCHOR_STRATEGY }).ok).toBe(true);
  });
});

describe('publicação — o ponteiro da estratégia âncora é outro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async callback => callback('session-test'));
    mocks.bulkWrite.mockResolvedValue({ ok: 1 });
  });

  const analysisFor = (strategy, ranking) => ({
    _id: `analysis-${strategy}`,
    batchId: null,
    assetClass: 'STOCK',
    strategy,
    content: { ranking },
    save: vi.fn().mockResolvedValue(undefined),
  });

  it('publica a âncora sem tocar no ponteiro nem no conteúdo do semanal', async () => {
    const legacyRanking = [{ ticker: 'AAA3', score: 80, action: 'BUY', riskProfile: 'DEFENSIVE', position: 1 }];
    const legacy = analysisFor('BUY_HOLD', legacyRanking);
    const legacySnapshot = JSON.parse(JSON.stringify(legacy.content.ranking));

    const anchor = analysisFor(ANCHOR_STRATEGY, [
      anchorItem({ ticker: 'CPFE3', score: 81 }),
      anchorItem({ ticker: 'TAEE11', score: 88, action: 'WAIT', reason: 'Âncora segura, porém cara — aguarde preço' }),
    ]);

    await activateResearchSections({ analysis: anchor, sections: ['RANKING'] });

    // O ponteiro escrito é o da estratégia âncora, e só ele.
    expect(mocks.bulkWrite).toHaveBeenCalledTimes(1);
    const [operations] = mocks.bulkWrite.mock.calls[0];
    expect(operations).toHaveLength(1);
    expect(operations[0].updateOne.filter).toEqual({
      assetClass: 'STOCK', strategy: ANCHOR_STRATEGY, section: 'RANKING',
    });

    // O documento do semanal não foi lido, salvo nem alterado.
    expect(legacy.save).not.toHaveBeenCalled();
    expect(legacy.content.ranking).toEqual(legacySnapshot);
    expect(legacy.isRankingPublished).toBeUndefined();

    // E o AGUARDAR caro continuou AGUARDAR mesmo com score 88.
    const caro = anchor.content.ranking.find(row => row.ticker === 'TAEE11');
    expect(caro.action).toBe('WAIT');
    expect(caro.position).toBe(1); // 88 > 81: ordem soberana por score, preservada
  });

  it('publicar o semanal segue derivando a action pelo limiar de 70', async () => {
    const legacy = analysisFor('BUY_HOLD', [
      { ticker: 'AAA3', score: 80, action: 'WAIT', riskProfile: 'DEFENSIVE' },
      { ticker: 'BBB4', score: 40, action: 'BUY', riskProfile: 'MODERATE' },
    ]);

    await activateResearchSections({ analysis: legacy, sections: ['RANKING'] });

    expect(legacy.content.ranking.map(row => [row.ticker, row.action])).toEqual([
      ['AAA3', 'BUY'],
      ['BBB4', 'WAIT'],
    ]);
    const [operations] = mocks.bulkWrite.mock.calls[0];
    expect(operations[0].updateOne.filter.strategy).toBe('BUY_HOLD');
  });

  it('recusa publicar uma lista âncora que fura o limiar sem histerese', async () => {
    const anchor = analysisFor(ANCHOR_STRATEGY, [
      anchorItem({ ticker: 'FURA3', score: 55, action: 'BUY', anchor: { axes: {}, hysteresis: { state: 'ENTERED' } } }),
    ]);

    await expect(activateResearchSections({ analysis: anchor, sections: ['RANKING'] }))
      .rejects.toThrow(/Ranking inválido/);
    expect(mocks.bulkWrite).not.toHaveBeenCalled();
  });
});
