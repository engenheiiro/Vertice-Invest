/**
 * O rastro da retenção de assento tem que SOBREVIVER ao Mongoose.
 *
 * Este arquivo existe por um defeito específico e recorrente neste schema: um
 * campo não declarado é descartado silenciosamente no save. Foi o que aconteceu
 * com `volatility`/`beta` no RankingItemSchema (persistidos só depois de serem
 * declarados; até lá o Comparador mostrava "N/A"). Com a retenção o sintoma
 * seria pior: a lista mostraria um AGUARDAR no meio do ranking sem nenhuma
 * explicação de por que ele está ali, e as saídas sumiriam da tela.
 *
 * Não toca no banco — só instancia o documento e lê de volta.
 */
import { describe, it, expect } from 'vitest';
import MarketAnalysis from '../models/MarketAnalysis.js';

const retention = {
  retained: true,
  holdScore: 62,
  previousPosition: 7,
  previousScore: 73,
  previousProfile: 'DEFENSIVE',
  displaced: { ticker: 'EUCA4', score: 58 },
  reason: 'Na lista desde a apuração anterior: score 67 segue acima do mínimo para manter a vaga (62)',
};

const buildDoc = () => new MarketAnalysis({
  assetClass: 'STOCK',
  strategy: 'BUY_HOLD',
  content: {
    ranking: [
      { position: 1, ticker: 'ITUB4', score: 84, action: 'BUY', riskProfile: 'DEFENSIVE' },
      { position: 2, ticker: 'COGN3', score: 67, action: 'WAIT', riskProfile: 'BOLD', retention },
    ],
  },
  retentionExits: [{
    ticker: 'PINE4',
    name: 'Banco Pine',
    reason: 'Saiu da lista: score caiu para 60, abaixo do mínimo para manter a vaga (62)',
    outcome: 'BELOW_HOLD',
    score: 60,
    previousScore: 74,
  }],
});

describe('persistência do rastro de retenção', () => {
  it('o payload `retention` do item sobrevive inteiro ao schema', () => {
    const item = buildDoc().toObject().content.ranking[1];
    expect(item.retention).toEqual(retention);
  });

  it('item que entrou pelo draft normal não ganha `retention` inventado', () => {
    const item = buildDoc().toObject().content.ranking[0];
    expect(item.retention).toBeNull();
  });

  it('as saídas sobrevivem com o motivo escrito e o código do desfecho', () => {
    const [exit] = buildDoc().toObject().retentionExits;
    expect(exit).toMatchObject({
      ticker: 'PINE4',
      outcome: 'BELOW_HOLD',
      score: 60,
      previousScore: 74,
    });
    expect(exit.reason).toMatch(/abaixo do mínimo para manter a vaga \(62\)/);
  });

  it('`action` continua coerente com o score mesmo no item retido', () => {
    // A retenção mexe no assento, nunca na ação. Um retido com 67 é AGUARDAR.
    const ranking = buildDoc().toObject().content.ranking;
    expect(ranking.every(i => i.action === (i.score >= 70 ? 'BUY' : 'WAIT'))).toBe(true);
  });

  it('documento da âncora não ganha retentionExits por tabela', () => {
    const anchor = new MarketAnalysis({ assetClass: 'STOCK', strategy: 'BUY_AND_HOLD', content: { ranking: [] } });
    expect(anchor.toObject().retentionExits).toEqual([]);
  });
});
