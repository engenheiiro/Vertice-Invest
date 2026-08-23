/**
 * TETO DE COMPOSIÇÃO x HISTERESE — a interação entre as duas camadas.
 *
 * O teto de composição da lista publicável de FIIs (1/3 de papel, 1/3 por
 * gestora) roda DENTRO do motor, sobre os itens que estão em COMPRAR naquele
 * instante. A histerese roda DEPOIS, na camada de publicação, e pode devolver ao
 * COMPRAR um fundo que o motor tinha deixado de fora por SCORE — e que, por ter
 * saído por score, nunca foi contado nas vagas do teto.
 *
 * Sem reaplicar o teto depois da histerese, um segundo fundo de papel (ou um
 * terceiro da mesma gestora) entra pela porta da histerese furando o limite que o
 * motor acabara de aplicar. O efeito é zero na PRIMEIRA publicação (sem lista
 * anterior não há o que manter) e só aparece a partir da segunda — motivo pelo
 * qual estes testes simulam uma publicação anterior.
 *
 * Em 22/08/2026 a lista tinha KNCR11 (papel) em COMPRAR e HGCR11=69 / BTHF11=67
 * (papel) na faixa de permanência: o cenário abaixo não é hipotético.
 */
import { describe, expect, it, vi } from 'vitest';

import { HYSTERESIS_STATES } from '../utils/anchorHysteresis.js';

const mocks = vi.hoisted(() => ({
  generateFii: vi.fn(),
  generateStock: vi.fn(),
  findPointer: vi.fn(),
  findAnalysisById: vi.fn(),
}));

vi.mock('../services/fiiBuyAndHoldService.js', () => ({
  fiiBuyAndHoldService: { generateFiiBuyAndHoldRanking: mocks.generateFii },
}));
vi.mock('../services/buyAndHoldService.js', () => ({
  buyAndHoldService: { generateBuyAndHoldRanking: mocks.generateStock },
}));
vi.mock('../models/PublishedResearchPointer.js', () => ({
  default: { findOne: (...args) => mocks.findPointer(...args) },
}));
vi.mock('../models/MarketAnalysis.js', () => ({
  default: { findById: (...args) => mocks.findAnalysisById(...args) },
}));
vi.mock('../models/SystemConfig.js', () => ({ default: { findOne: vi.fn() } }));

const { buildAnchorRanking } = await import('../services/anchorPublicationService.js');

/** Linha no formato que `compactRow` de fiiBuyAndHoldService entrega. */
const fii = (over = {}) => ({
  ticker: 'AAAA11',
  name: 'Fundo A',
  sector: 'Logística',
  subType: 'TIJOLO',
  manager: 'GESTORA A',
  score: 75,
  action: 'BUY',
  axes: { durability: 70, resilience: 70, consistency: 70 },
  reason: 'Âncora de renda com spread confortável',
  entry: { expensive: false },
  expensive: false,
  payoutUncovered: false,
  publicationLimit: undefined,
  ...over,
});

/** Publicação anterior: todo mundo em COMPRAR. */
const publishedAs = (tickers) => {
  mocks.findPointer.mockReturnValue({
    lean: () => Promise.resolve({ analysis: 'analysis-anterior', activatedAt: new Date() }),
  });
  mocks.findAnalysisById.mockReturnValue({
    select: () => ({
      lean: () => Promise.resolve({
        content: { ranking: tickers.map(ticker => ({ ticker, action: 'BUY', score: 76 })) },
      }),
    }),
  });
};

const generateFiiRanking = (ranking) => {
  mocks.generateFii.mockResolvedValue({
    version: 'FII_BH_V1',
    generatedAt: new Date(),
    ranking: ranking.map((row, index) => ({ position: index + 1, ...row })),
    excluded: [],
    excludedByReason: [],
    counts: { analyzed: 122, eligible: 30, excluded: 92 },
  });
};

const buysOf = built => built.ranking.filter(row => row.action === 'BUY');
const capFor = total => Math.max(1, Math.floor(total * 0.34));

describe('teto de composição reaplicado DEPOIS da histerese', () => {
  it('não deixa a histerese promover um segundo fundo de PAPEL acima do teto', async () => {
    // O motor entrega 3 COMPRAR (1 de papel, teto respeitado) e KNSC11 fora do
    // COMPRAR por SCORE — o teto do motor nem o considerou, porque ele só olha
    // quem está em COMPRAR.
    generateFiiRanking([
      fii({ ticker: 'KNCR11', score: 79, subType: 'PAPEL', manager: 'KINEA' }),
      fii({ ticker: 'PMLL11', score: 71, manager: 'PATRIA' }),
      fii({ ticker: 'HSLG11', score: 71, manager: 'HSI' }),
      fii({
        ticker: 'HGCR11', score: 65, action: 'WAIT', subType: 'PAPEL', manager: 'CSHG',
        reason: 'Âncora de renda, mas convicção insuficiente',
      }),
    ]);
    publishedAs(['KNCR11', 'PMLL11', 'HSLG11', 'HGCR11']);

    const built = await buildAnchorRanking('FII');
    const buys = buysOf(built);
    const papel = buys.filter(row => row.anchor.subType === 'PAPEL');

    expect(papel.length).toBeLessThanOrEqual(capFor(buys.length));
    expect(buys.map(row => row.ticker)).toEqual(['KNCR11', 'PMLL11', 'HSLG11']);

    // Quem foi barrado sai com motivo escrito e deixa de contar como mantido.
    const barrado = built.ranking.find(row => row.ticker === 'HGCR11');
    expect(barrado.action).toBe('WAIT');
    expect(barrado.anchor.hysteresis.state).toBe(HYSTERESIS_STATES.OUT);
    expect(barrado.anchor.exitReason).toContain('teto de composição');
    expect(built.exits.map(exit => exit.ticker)).toContain('HGCR11');
    expect(built.counts.held).toBe(0);
    expect(built.counts.buy).toBe(3);
    expect(built.counts.exits).toBe(built.exits.length);
  });

  it('não deixa a histerese promover um terceiro fundo da MESMA gestora', async () => {
    generateFiiRanking([
      fii({ ticker: 'KNCR11', score: 79, manager: 'KINEA' }),
      fii({ ticker: 'PMLL11', score: 71, manager: 'PATRIA' }),
      fii({ ticker: 'HSLG11', score: 71, manager: 'HSI' }),
      fii({
        ticker: 'KNHF11', score: 66, action: 'WAIT', manager: 'KINEA',
        reason: 'Âncora de renda, mas convicção insuficiente',
      }),
    ]);
    publishedAs(['KNCR11', 'PMLL11', 'HSLG11', 'KNHF11']);

    const built = await buildAnchorRanking('FII');
    const buys = buysOf(built);
    const kinea = buys.filter(row => row.anchor.manager === 'KINEA');

    expect(kinea.length).toBeLessThanOrEqual(capFor(buys.length));
    expect(built.ranking.find(row => row.ticker === 'KNHF11').action).toBe('WAIT');
  });

  it('MANTÉM o promovido quando ele cabe no teto — o freio é de composição, não de histerese', async () => {
    // 5 COMPRAR do motor + 1 promovido = 6, e o teto de papel vira 2. O papel
    // mantido pela banda passa a caber: o teto guarda a fração da lista FINAL.
    generateFiiRanking([
      fii({ ticker: 'KNCR11', score: 79, subType: 'PAPEL', manager: 'KINEA' }),
      fii({ ticker: 'PMLL11', score: 75, manager: 'PATRIA' }),
      fii({ ticker: 'HSLG11', score: 74, manager: 'HSI' }),
      fii({ ticker: 'XPML11', score: 73, manager: 'XP' }),
      fii({ ticker: 'VISC11', score: 72, manager: 'VINCI' }),
      fii({
        ticker: 'HGCR11', score: 65, action: 'WAIT', subType: 'PAPEL', manager: 'CSHG',
        reason: 'Âncora de renda, mas convicção insuficiente',
      }),
    ]);
    publishedAs(['KNCR11', 'PMLL11', 'HSLG11', 'XPML11', 'VISC11', 'HGCR11']);

    const built = await buildAnchorRanking('FII');
    const buys = buysOf(built);

    expect(buys).toHaveLength(6);
    expect(built.ranking.find(row => row.ticker === 'HGCR11').action).toBe('BUY');
    expect(built.counts.held).toBe(1);
    expect(built.exits).toHaveLength(0);
  });

  it('não demove nada que o próprio motor já tinha admitido', async () => {
    // Dois papéis em COMPRAR pelo motor (lista de 6, teto 2) e um terceiro
    // promovido pela banda: quem cai é o promovido, nunca os admitidos.
    generateFiiRanking([
      fii({ ticker: 'KNCR11', score: 79, subType: 'PAPEL', manager: 'KINEA' }),
      fii({ ticker: 'HGCR11', score: 78, subType: 'PAPEL', manager: 'CSHG' }),
      fii({ ticker: 'PMLL11', score: 75, manager: 'PATRIA' }),
      fii({ ticker: 'HSLG11', score: 74, manager: 'HSI' }),
      fii({ ticker: 'XPML11', score: 73, manager: 'XP' }),
      fii({ ticker: 'VISC11', score: 72, manager: 'VINCI' }),
      fii({
        ticker: 'BTHF11', score: 64, action: 'WAIT', subType: 'PAPEL', manager: 'BTG',
        reason: 'Âncora de renda, mas convicção insuficiente',
      }),
    ]);
    publishedAs(['KNCR11', 'HGCR11', 'PMLL11', 'HSLG11', 'XPML11', 'VISC11', 'BTHF11']);

    const built = await buildAnchorRanking('FII');
    const buys = buysOf(built);

    expect(buys.map(row => row.ticker)).toEqual(['KNCR11', 'HGCR11', 'PMLL11', 'HSLG11', 'XPML11', 'VISC11']);
    expect(built.ranking.find(row => row.ticker === 'BTHF11').action).toBe('WAIT');
    expect(built.exits.map(exit => exit.ticker)).toEqual(['BTHF11']);
  });

  it('na PRIMEIRA publicação nada muda — sem lista anterior não há promoção', async () => {
    mocks.findPointer.mockReturnValue({ lean: () => Promise.resolve(null) });
    generateFiiRanking([
      fii({ ticker: 'KNCR11', score: 79, subType: 'PAPEL', manager: 'KINEA' }),
      fii({ ticker: 'PMLL11', score: 71, manager: 'PATRIA' }),
      fii({ ticker: 'HSLG11', score: 71, manager: 'HSI' }),
      fii({
        ticker: 'HGCR11', score: 65, action: 'WAIT', subType: 'PAPEL', manager: 'CSHG',
        reason: 'Âncora de renda, mas convicção insuficiente',
      }),
    ]);

    const built = await buildAnchorRanking('FII');

    expect(built.bootstrap).toBe(true);
    expect(buysOf(built).map(row => row.ticker)).toEqual(['KNCR11', 'PMLL11', 'HSLG11']);
    expect(built.exits).toHaveLength(0);
  });
});

describe('ações não têm teto de composição — o caminho segue intocado', () => {
  it('mantém o promovido pela banda, sem reaplicar teto nenhum', async () => {
    mocks.generateStock.mockResolvedValue({
      version: 'BH_V1',
      generatedAt: new Date(),
      ranking: [
        { position: 1, ticker: 'CPFE3', name: 'CPFL', score: 81, action: 'BUY', axes: { durability: 80, resilience: 75, consistency: 70 }, reason: 'Âncora', entry: { expensive: false }, expensive: false },
        { position: 2, ticker: 'BRSR6', name: 'Banrisul', score: 65, action: 'WAIT', axes: { durability: 60, resilience: 60, consistency: 60 }, reason: 'Convicção insuficiente', entry: { expensive: false }, expensive: false },
      ],
      excluded: [],
      excludedByReason: [],
      counts: { analyzed: 200, eligible: 17, excluded: 183 },
    });
    publishedAs(['CPFE3', 'BRSR6']);

    const built = await buildAnchorRanking('STOCK');

    expect(buysOf(built).map(row => row.ticker)).toEqual(['CPFE3', 'BRSR6']);
    expect(built.counts.held).toBe(1);
    expect(built.exits).toHaveLength(0);
  });
});
