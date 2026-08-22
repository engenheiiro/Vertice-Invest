import { describe, expect, it } from 'vitest';
import {
  buildBuyAndHoldRanking,
  computeEntryPenalty,
  computeFfoCoverage,
  sanitizeFfoYield,
  scoreBuyAndHold,
} from '../services/engines/fiiBuyAndHoldEngine.js';
import { FII_BUY_AND_HOLD_CONFIG } from '../config/fiiBuyAndHold.js';

// Fixtures ancoradas na base de produção de 22/08/2026. NTN-B longa oficial do
// Tesouro Transparente no mesmo dia: 7,96% a.a.
const CONTEXT = { MACRO: { NTNB_LONG: 7.96, SELIC: 14, RATES_STALE: false } };

const fii = ({ ticker, name, sector, fiiSubType, isTier1 = false, marketCap, liquidity, dy, vacancy = 0, qtdImoveis = 0, ffoYield = 0, ffoCota = 0, price, volatility = 10, quality = 60, risk = 60, consistency }) => ({
  ticker, name, sector, fiiSubType, isTier1, currentPrice: price, consistency,
  metrics: {
    marketCap, avgLiquidity: liquidity, dy, vacancy, qtdImoveis, ffoYield, ffoCota,
    price, volatility, sector, fiiSubType, structural: { quality, valuation: 60, risk },
  },
});

// Papel tier-1 da Kinea: spread de 3,29 p.p. e P/FFO de 7,3x — âncora barata.
const knsc11 = fii({
  ticker: 'KNSC11', name: 'Kinea Securities FII', sector: 'Papel', fiiSubType: 'PAPEL', isTier1: true,
  marketCap: 1_821_840_000, liquidity: 4_333_200, dy: 11.25,
  ffoYield: 13.68, ffoCota: 1.23, price: 9.01, volatility: 9.56, quality: 85, risk: 70,
});

// Tijolo de primeira linha, mas rendendo apenas 0,14 p.p. acima da NTN-B: caro.
const hglg11 = fii({
  ticker: 'HGLG11', name: 'CSHG Logística FII', sector: 'Logística', fiiSubType: 'TIJOLO', isTier1: true,
  marketCap: 6_713_030_000, liquidity: 17_560_600, dy: 8.1, vacancy: 3.23, qtdImoveis: 60,
  ffoYield: 6.61, ffoCota: 9.73, price: 147.21, volatility: 7.09, quality: 80, risk: 85,
});

// Arquétipo da armadilha de yield que passa em todos os outros filtros: DY de
// 14,82% com FFO/cota de R$ 4,24 contra provento de R$ 10,64 — cobertura 0,40x.
const trxf11 = fii({
  ticker: 'TRXF11', name: 'TRX Real Estate FII', sector: 'Renda Urbana', fiiSubType: 'TIJOLO', isTier1: true,
  marketCap: 4_482_520_000, liquidity: 26_321_000, dy: 14.82, vacancy: 0, qtdImoveis: 97,
  ffoYield: 5.91, ffoCota: 4.24, price: 71.8, volatility: 12.29, quality: 80, risk: 85,
});

// Tijolo de shopping com renda operacional e preço na banda: âncora comprável.
const pmll11 = fii({
  ticker: 'PMLL11', name: 'Pátria Malls FII', sector: 'Shoppings', fiiSubType: 'TIJOLO',
  marketCap: 1_409_810_000, liquidity: 4_531_640, dy: 10.02, vacancy: 3.69, qtdImoveis: 12,
  ffoYield: 10.32, ffoCota: 10.41, price: 100.83, volatility: 8.70, quality: 80, risk: 70,
});

const tgar11 = fii({
  ticker: 'TGAR11', name: 'TG Ativo Real FII', sector: 'Desenvolvimento', fiiSubType: 'DESENVOLVIMENTO',
  marketCap: 1_034_630_000, liquidity: 3_747_760, dy: 20.66, qtdImoveis: 4,
  ffoYield: 24.16, ffoCota: 10.61, price: 43.9, volatility: 28.22,
});

describe('scoreBuyAndHold (FII) — casos de referência', () => {
  it('fundo de desenvolvimento é inelegível — nunca aparece', () => {
    const r = scoreBuyAndHold(tgar11, CONTEXT);
    expect(r.eligible).toBe(false);
    expect(r.action).toBe('WAIT');
  });

  it('papel tier-1 barato e com renda operacional vira COMPRAR (KNSC11)', () => {
    const r = scoreBuyAndHold(knsc11, CONTEXT);
    expect(r.eligible).toBe(true);
    expect(r.entry.expensive).toBe(false);
    expect(r.payoutUncovered).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.action).toBe('BUY');
  });

  it('tijolo de elite com spread comprimido é âncora, mas cara → AGUARDAR (HGLG11)', () => {
    const r = scoreBuyAndHold(hglg11, CONTEXT);
    expect(r.eligible).toBe(true);
    expect(r.composite).toBeGreaterThanOrEqual(70);
    expect(r.entry.spreadCompressed).toBe(true);
    expect(r.action).toBe('WAIT');
    expect(r.reason).toMatch(/cara|preço/i);
  });
});

describe('valuation é FREIO, nunca bônus', () => {
  it('spread dentro da banda não penaliza', () => {
    const entry = computeEntryPenalty(pmll11, CONTEXT);
    expect(entry.spread).toBeCloseTo(2.06, 2);
    expect(entry.spreadCompressed).toBe(false);
    expect(entry.spreadStretched).toBe(false);
  });

  it('spread comprimido penaliza e marca expensive', () => {
    const entry = computeEntryPenalty(hglg11, CONTEXT);
    expect(entry.spreadCompressed).toBe(true);
    expect(entry.penalty).toBeGreaterThan(0);
    expect(entry.expensive).toBe(true);
  });

  // Prêmio grande demais é prêmio de RISCO, não desconto: penaliza pontos, mas
  // não entra como "barato" — premiar isso seria premiar armadilha de yield.
  it('spread esticado penaliza sem marcar barganha', () => {
    // DY 18% (spread 10,04) com P/FFO de 8,3x: o múltiplo está barato, então
    // quem penaliza aqui é só o spread — e ele não marca `expensive`.
    const stretched = { ...trxf11, metrics: { ...trxf11.metrics, dy: 18, ffoYield: 12 } };
    const entry = computeEntryPenalty(stretched, CONTEXT);
    expect(entry.spreadStretched).toBe(true);
    expect(entry.pFfoExpensive).toBe(false);
    expect(entry.penalty).toBeGreaterThan(0);
    expect(entry.expensive).toBe(false);
  });

  it('P/FFO caro segura o COMPRAR mesmo com spread na banda', () => {
    // DY 10,02 (spread 2,06 — dentro da banda), mas FFO Yield de 3,4% → P/FFO 29x.
    const richMultiple = { ...pmll11, metrics: { ...pmll11.metrics, ffoYield: 3.46 } };
    const entry = computeEntryPenalty(richMultiple, CONTEXT);
    expect(entry.spreadCompressed).toBe(false);
    expect(entry.pFfoExpensive).toBe(true);
    expect(entry.expensive).toBe(true);
    expect(scoreBuyAndHold(richMultiple, CONTEXT).action).toBe('WAIT');
  });

  it('a penalidade nunca é negativa: o freio jamais vira bônus', () => {
    // Fundo barato nos dois eixos (spread 4,54 p.p., P/FFO 5x) não ganha nada
    // por isso — o máximo que o valuation faz é não subtrair.
    const cheap = { ...pmll11, metrics: { ...pmll11.metrics, dy: 12.5, ffoYield: 20 } };
    const entry = computeEntryPenalty(cheap, CONTEXT);
    expect(entry.penalty).toBe(0);
    expect(entry.expensive).toBe(false);
  });

  it('score nunca supera o composite dos eixos — valuation só subtrai', () => {
    for (const asset of [knsc11, hglg11, trxf11, pmll11]) {
      const r = scoreBuyAndHold(asset, CONTEXT);
      expect(r.score).toBeLessThanOrEqual(r.composite);
    }
  });
});

describe('FFO — saneamento e cobertura da distribuição', () => {
  // Os 7 outliers reais da base: CPTR11 128,5% · KOPA11 53,31 · MMPD11 46,57 ·
  // RELG11 38,14 · HCRI11 34,88 · VVRI11 32,95 · SMRE11 32,58.
  it('FFO Yield fora da banda plausível vira AUSENTE, não nota baixa', () => {
    expect(sanitizeFfoYield(128.5)).toBeNull();
    expect(sanitizeFfoYield(53.31)).toBeNull();
    expect(sanitizeFfoYield(32.58)).toBeNull();
    expect(sanitizeFfoYield(13.68)).toBe(13.68);
  });

  // 0 significa "a fonte não publicou", jamais "ruim".
  it('FFO Yield zerado é ausência, e sem ele o freio de P/FFO não morde', () => {
    expect(sanitizeFfoYield(0)).toBeNull();
    const noFfo = { ...pmll11, metrics: { ...pmll11.metrics, ffoYield: 0 } };
    const entry = computeEntryPenalty(noFfo, CONTEXT);
    expect(entry.pFfo).toBeNull();
    expect(entry.pFfoExpensive).toBe(false);
  });

  it('cobertura = FFO por cota ÷ provento por cota', () => {
    // TRXF11: R$ 4,24 de FFO contra R$ 71,80 × 14,82% = R$ 10,64 distribuídos.
    expect(computeFfoCoverage(trxf11)).toBeCloseTo(0.4, 2);
    expect(computeFfoCoverage(pmll11)).toBeCloseTo(1.03, 2);
  });

  it('cobertura ausente quando falta insumo', () => {
    expect(computeFfoCoverage({ ...pmll11, metrics: { ...pmll11.metrics, ffoCota: 0 } })).toBeNull();
  });

  // O teste que impede a armadilha de yield de virar a primeira posição do
  // ranking: renda financiada por ganho de capital/amortização não é âncora.
  it('distribuição não coberta pelo FFO veta o COMPRAR sem excluir o fundo (TRXF11)', () => {
    const r = scoreBuyAndHold(trxf11, CONTEXT);
    expect(r.eligible).toBe(true);
    expect(r.payoutUncovered).toBe(true);
    expect(r.action).toBe('WAIT');
    expect(r.reason).toMatch(/não coberta pelo FFO/i);
  });
});

describe('consistência com track record dormente', () => {
  // O FundamentalSnapshot tem 1 leitura por FII contra TRACK_RECORD_MIN_PERIODS = 6:
  // o eixo precisa degradar com elegância, nunca zerar o ativo.
  it('sem streak verificado o teto de confiança limita o score, mas o eixo vive', () => {
    const r = scoreBuyAndHold(pmll11, CONTEXT);
    expect(r.distributionVerified).toBe(false);
    expect(r.confidenceCap).toBe(FII_BUY_AND_HOLD_CONFIG.gate.distribution.capWhenUnverified);
    expect(r.axes.consistency).toBeGreaterThan(0);
  });

  it('streak verificado libera o teto para 100', () => {
    const withHistory = {
      ...pmll11,
      consistency: { distributionStreakYears: 8, dyVolatility: 0.8, maxDrawdownPct: 22 },
    };
    const r = scoreBuyAndHold(withHistory, CONTEXT);
    expect(r.distributionVerified).toBe(true);
    expect(r.confidenceCap).toBe(100);
  });
});

describe('eixos — dados inaplicáveis não viram nota baixa', () => {
  it('FII de papel não é penalizado por vacância/imóveis inexistentes', () => {
    const paper = scoreBuyAndHold(knsc11, CONTEXT);
    const brick = scoreBuyAndHold({ ...pmll11, quality: 85 }, CONTEXT);
    // O peso das partes ausentes é redistribuído: o papel não carrega zeros.
    expect(paper.audit.durability.map(c => c.metric)).not.toContain('vacancy');
    expect(paper.audit.durability.map(c => c.metric)).not.toContain('propertyDiversification');
    expect(paper.axes.durability).toBeGreaterThan(0);
    expect(brick.audit.durability.map(c => c.metric)).toContain('vacancy');
  });

  // Alavancagem de FII não existe na base (371 de 371 com debtToEquity = 0). Se o
  // ausente entrasse na escala como zero, "sem dívida publicada" viraria nota 100
  // de resiliência de graça — o oposto do que o dado diz.
  it('alavancagem ausente não vira nota máxima de resiliência', () => {
    const r = scoreBuyAndHold(pmll11, CONTEXT);
    expect(r.audit.resilience.map(c => c.metric)).not.toContain('leverage');

    const levered = { ...pmll11, metrics: { ...pmll11.metrics, debtToEquity: 12 } };
    expect(scoreBuyAndHold(levered, CONTEXT).audit.resilience.map(c => c.metric)).toContain('leverage');
  });

  // Espelho do anterior na outra ponta da escala: cobertura de FFO ausente não
  // pode virar nota ZERO de durabilidade.
  it('cobertura de FFO ausente não vira nota zero de durabilidade', () => {
    const noFfo = { ...pmll11, metrics: { ...pmll11.metrics, ffoYield: 0, ffoCota: 0 } };
    const r = scoreBuyAndHold(noFfo, CONTEXT);
    expect(r.ffoCoverage).toBeNull();
    expect(r.audit.durability.map(c => c.metric)).not.toContain('ffoCoverage');
    expect(r.axes.durability).toBeGreaterThan(scoreBuyAndHold(pmll11, CONTEXT).axes.durability - 30);
  });
});

// A fonte publica 91,81% de vacância para o XPML11 (14 shoppings, R$ 6,3 bi,
// DY de 10% e FFO positivo). Descartar o número não pode virar "vacância zero".
describe('vacância descartada — lacuna declarada, não nota', () => {
  const xpml11 = fii({
    ticker: 'XPML11', name: 'XP Malls FII', sector: 'Shoppings', fiiSubType: 'TIJOLO',
    marketCap: 6_327_910_000, liquidity: 16_255_300, dy: 10.01, vacancy: 91.81, qtdImoveis: 14,
    ffoYield: 8.32, ffoCota: 8.19, price: 98.40, volatility: 9.4, quality: 80, risk: 80,
  });

  it('entra no universo, mas sem componente de vacância na durabilidade', () => {
    const r = scoreBuyAndHold(xpml11, CONTEXT);
    expect(r.eligible).toBe(true);
    expect(r.vacancy.credible).toBe(false);
    expect(r.audit.durability.map(c => c.metric)).not.toContain('vacancy');
  });

  it('paga teto de confiança de 85 e escreve a lacuna no motivo', () => {
    const r = scoreBuyAndHold(xpml11, CONTEXT);
    expect(r.confidenceCap).toBe(85);
    expect(r.score).toBeLessThanOrEqual(85);
    expect(r.reason).toContain('desmentida pelo próprio caixa');
  });

  it('descartar não é dar nota boa: 0% de vacância pontua mais', () => {
    const clean = { ...xpml11, metrics: { ...xpml11.metrics, vacancy: 2 } };
    expect(scoreBuyAndHold(clean, CONTEXT).axes.durability)
      .toBeGreaterThan(scoreBuyAndHold(xpml11, CONTEXT).axes.durability);
  });
});

describe('buildBuyAndHoldRanking (FII)', () => {
  const universe = [knsc11, hglg11, trxf11, pmll11, tgar11];

  it('só lista elegíveis e ordena por score', () => {
    const result = buildBuyAndHoldRanking(universe, CONTEXT);
    const tickers = result.ranking.map(item => item.ticker);
    expect(tickers).not.toContain('TGAR11');
    expect(result.counts.eligible).toBe(4);
    expect(result.counts.excluded).toBe(1);
    for (let i = 1; i < result.ranking.length; i += 1) {
      expect(result.ranking[i - 1].score).toBeGreaterThanOrEqual(result.ranking[i].score);
    }
  });

  // O defeito que este motor existe para não repetir: o Research semanal publica
  // 28–30 COMPRAR de 30 há 12 publicações seguidas. Um ranking âncora SEPARA.
  it('nem todo elegível sai como COMPRAR — o freio de preço realmente frita', () => {
    const result = buildBuyAndHoldRanking(universe, CONTEXT);
    expect(result.counts.eligible).toBeGreaterThan(0);
    expect(result.counts.buy).toBeGreaterThan(0);
    expect(result.counts.wait).toBeGreaterThan(0);
    expect(result.counts.buy).toBeLessThan(result.counts.eligible);
  });

  it('limita concentração por gestora: o 3º fundo da casa perde pontos', () => {
    const kineaClone = (suffix, dy) => ({
      ...knsc11, ticker: `KN${suffix}11`, name: `Kinea ${suffix}`,
      metrics: { ...knsc11.metrics, dy },
    });
    // Quatro fundos Kinea; os dois melhores passam intactos, 3º e 4º penalizam.
    const result = buildBuyAndHoldRanking(
      [kineaClone('SC', 11.25), kineaClone('CR', 11.2), kineaClone('IP', 11.15), kineaClone('HY', 11.1)],
      CONTEXT,
    );
    const penalized = result.ranking.filter(item => item.concentration);
    expect(penalized).toHaveLength(2);
    expect(penalized.map(item => item.concentration.rank)).toEqual([3, 4]);
    expect(penalized[0].concentration.penalty).toBe(FII_BUY_AND_HOLD_CONFIG.concentration.thirdPenalty);
    expect(penalized[1].concentration.penalty).toBe(FII_BUY_AND_HOLD_CONFIG.concentration.overflowPenalty);
    expect(result.ranking.filter(item => !item.concentration)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Teto de COMPOSIÇÃO da lista publicável.
//
// A penalidade de gestora incide sobre os ELEGÍVEIS e só começa no 3º fundo da
// casa, então nunca tocava o topo: em 22/08/2026 os 4 COMPRAR eram KNCR11 e
// KNSC11 (papel, Kinea, 1º e 2º), PMLL11 e HSLG11 — metade crédito, metade
// Kinea, com a penalidade intacta. Um teto que não morde o topo não é teto.
// ---------------------------------------------------------------------------
describe('teto de composição da lista publicável (COMPRAR)', () => {
  const { publication } = FII_BUY_AND_HOLD_CONFIG;

  // Clones de fundos que já saem como COMPRAR nos casos de referência acima.
  const paperClone = (ticker, dy) => ({
    ...knsc11, ticker, name: `Papel ${ticker}`, metrics: { ...knsc11.metrics, dy },
  });
  // Tijolo de porte que sai como COMPRAR por mérito próprio — o alvo do teto é a
  // composição da lista, então os fixtures precisam disputar de verdade.
  const brickClone = (ticker, sector, dy) => fii({
    ticker, name: `Tijolo ${ticker}`, sector, fiiSubType: 'TIJOLO',
    marketCap: 3_409_810_000, liquidity: 8_531_640, dy, vacancy: 3.69, qtdImoveis: 12,
    ffoYield: 10.32, ffoCota: 10.41, price: 100.83, volatility: 8.70, quality: 80, risk: 85,
  });

  /** Invariante do produto: a lista publicável nunca pode violar os tetos. */
  const assertPublishable = ranking => {
    const buys = ranking.filter(item => item.action === 'BUY');
    const paperCap = Math.max(publication.minPerBucket, Math.floor(buys.length * publication.maxPaperShare));
    const managerCap = Math.max(publication.minPerBucket, Math.floor(buys.length * publication.maxManagerShare));

    expect(buys.filter(item => item.subType === 'PAPEL').length).toBeLessThanOrEqual(paperCap);
    const perManager = new Map();
    for (const item of buys) perManager.set(item.manager, (perManager.get(item.manager) || 0) + 1);
    for (const count of perManager.values()) expect(count).toBeLessThanOrEqual(managerCap);
    return buys;
  };

  it('metade da lista em papel não é publicável — o excedente vira AGUARDAR', () => {
    // Reprodução da lista real: 2 papéis Kinea no topo + 2 tijolos de casas distintas.
    const result = buildBuyAndHoldRanking([
      paperClone('KNCR11', 11.3), paperClone('KNSC11', 11.25),
      brickClone('PMLL11', 'Shoppings', 10.02), brickClone('HSLG11', 'Logística', 10.28),
    ], CONTEXT);

    const buys = assertPublishable(result.ranking);
    expect(buys.filter(item => item.subType === 'PAPEL')).toHaveLength(1);
    expect(buys.map(item => item.ticker)).not.toContain('KNSC11');
  });

  it('metade da lista na mesma gestora não é publicável', () => {
    // Dois tijolos Pátria (PMLL e MALL) + um de outra casa: só um Pátria publica.
    const result = buildBuyAndHoldRanking([
      brickClone('PMLL11', 'Shoppings', 10.1), brickClone('MALL11', 'Shoppings', 10.02),
      brickClone('HSLG11', 'Logística', 10.28),
    ], CONTEXT);

    const buys = assertPublishable(result.ranking);
    expect(buys.filter(item => item.manager === 'PATRIA')).toHaveLength(1);
  });

  // O ponto do desenho: o fundo NÃO some, e o motivo não é demérito dele.
  it('o excedente mantém score e posição, e o motivo diz que o limite é de carteira', () => {
    const result = buildBuyAndHoldRanking([
      paperClone('KNCR11', 11.3), paperClone('KNSC11', 11.25),
      brickClone('PMLL11', 'Shoppings', 10.02), brickClone('HSLG11', 'Logística', 10.28),
    ], CONTEXT);

    const held = result.ranking.find(item => item.publicationLimit);
    expect(held.ticker).toBe('KNSC11');
    expect(held.action).toBe('WAIT');
    expect(held.publicationLimit.bucket).toBe('PAPER');
    expect(held.reason).toMatch(/composição de carteira/i);
    // Continua na lista, com o score que mereceu e a posição que a ordem soberana deu.
    expect(held.score).toBe(scoreBuyAndHold(paperClone('KNSC11', 11.25), CONTEXT).score);
    expect(held.position).toBeLessThan(result.ranking.length);
  });

  // Sem o ponto fixo, o teto seria calculado sobre a lista de PARTIDA: 8 papéis
  // e 2 tijolos dariam cap 3 e publicariam 3 de papel para 2 de tijolo — 60% de
  // crédito numa regra que promete 1/3.
  it('teto é resolvido por ponto fixo: demover encurta a lista e aperta o teto', () => {
    const papers = ['KNCR11', 'KNSC11', 'KNIP11', 'KNHY11', 'BTCR11', 'BTHF11', 'CPTS11', 'RECR11']
      .map((ticker, index) => paperClone(ticker, 11.3 - index * 0.01));
    const bricks = [
      brickClone('PMLL11', 'Shoppings', 10.02),
      brickClone('HSLG11', 'Logística', 10.01),
    ];

    const result = buildBuyAndHoldRanking([...papers, ...bricks], CONTEXT);
    const buys = assertPublishable(result.ranking);
    expect(buys.filter(item => item.subType === 'PAPEL')).toHaveLength(1);
    expect(buys).toHaveLength(3);
  });

  // Um nome só não é concentração: o teto não pode zerar a categoria.
  it('um único fundo de papel na lista continua publicável', () => {
    const result = buildBuyAndHoldRanking([
      paperClone('KNCR11', 11.3),
      brickClone('PMLL11', 'Shoppings', 10.02), brickClone('HSLG11', 'Logística', 10.28),
    ], CONTEXT);

    const buys = assertPublishable(result.ranking);
    expect(buys.filter(item => item.subType === 'PAPEL')).toHaveLength(1);
    expect(result.ranking.some(item => item.publicationLimit)).toBe(false);
  });

  // O teto é de COMPOSIÇÃO: não pode virar mais um motivo de reprovação para
  // quem já era AGUARDAR por preço ou por renda não operacional.
  it('não marca quem já era AGUARDAR por outro motivo', () => {
    const result = buildBuyAndHoldRanking([knsc11, hglg11, trxf11, pmll11], CONTEXT);
    for (const item of result.ranking) {
      if (item.publicationLimit) expect(item.entry.expensive).toBe(false);
    }
    expect(result.ranking.find(item => item.ticker === 'TRXF11').publicationLimit).toBeUndefined();
    expect(result.ranking.find(item => item.ticker === 'HGLG11').publicationLimit).toBeUndefined();
  });
});
