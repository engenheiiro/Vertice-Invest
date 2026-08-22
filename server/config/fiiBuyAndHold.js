/**
 * Configuração do ranking âncora de FIIs (estratégia BUY_AND_HOLD) — par do
 * server/config/buyAndHold.js, que cobre as ações.
 *
 * Produto: lista de FIIs de RENDA para carregar por muitos anos. Segurança é
 * PORTÃO (segmento curado + pisos quantitativos), não score: quem não passa nunca
 * aparece como BUY, por mais barato que esteja.
 *
 * Distinto da estratégia legada `BUY_HOLD` (Research semanal de 3 perfis), que
 * permanece intocada. Este módulo é data-only; a lógica vive em
 * server/services/engines/fiiBuyAndHoldEngine.js.
 *
 * Pisos calibrados contra a base de produção em 22/08/2026 (371 FIIs não
 * blacklistados): a configuração abaixo deixa 28 elegíveis de 19 gestoras
 * distintas — a "configuração B (Equilibrado)" do estudo de maturidade
 * (planejamento/ESTUDO-MATURIDADE-RANKING-2026-08.html). A configuração ampla
 * testada dava 54 nomes, 28 deles de papel: concentração inaceitável em crédito.
 */

import { FII_YIELD_TRAP_THRESHOLD } from './financialConstants.js';

export const FII_BUY_AND_HOLD_VERSION = 'FII_BH_V1';

/**
 * Segmentos de TIJOLO DE RENDA elegíveis (rótulo `sector` do MarketAsset,
 * normalizado sem acento/minúsculo no engine). Deliberadamente NÃO inclui
 * 'Multicategoria' e 'Outros' (110 fundos na base): rótulos vagos demais para
 * curar — quem cai neles não é reprovado por mérito, é reprovado por não ser
 * possível afirmar o que o fundo carrega.
 */
export const FII_ANCHOR_SEGMENTS = Object.freeze([
  'logistica',
  'lajes corporativas', 'escritorios',
  'shoppings',
  'renda urbana', 'varejo',
  'hibrido', // "híbrido de tijolo": o piso de imóveis abaixo derruba o híbrido de papel
]);

/**
 * Naturezas incompatíveis com âncora, barradas antes de qualquer número:
 * desenvolvimento (risco de obra, renda futura), fundo de fundos (taxa sobre
 * taxa e look-through impossível) e FIAGRO (crédito/commodity agrícola, não
 * imóvel de renda). Rótulo vem de `fiiSubType`; FIAGRO existe na base ainda que
 * fora do enum do schema.
 */
export const FII_EXCLUDED_SUBTYPES = Object.freeze(['DESENVOLVIMENTO', 'FOF', 'FIAGRO']);

/** Marcadores de prazo determinado / amortização no nome do fundo. */
export const FII_TERMINATION_HINTS = Object.freeze([
  'prazo determinado', 'em amortizacao', 'amortizacao', 'liquidacao', 'em liquidacao',
]);

export const FII_BUY_AND_HOLD_CONFIG = Object.freeze({
  version: FII_BUY_AND_HOLD_VERSION,

  gate: Object.freeze({
    minMarketCap: 500_000_000, // R$ 500 M — piso de porte/estabilidade do setor
    minAvgLiquidity: 1_000_000, // R$ 1 M/dia — execução real sem slippage
    maxVacancy: 12, // % — mesmo teto do gate Defensivo do scoringEngine
    minProperties: 2, // mono-ativo de tijolo não é âncora
    minDy: 4, // sem renda corrente não é âncora de renda
    // Armadilha de yield: acima disso o DY é amortização/evento não recorrente,
    // não renda. Mesmo limiar que o scoringEngine já usa para FII.
    maxDy: FII_YIELD_TRAP_THRESHOLD,
    // Alavancagem (% do PL). O Fundamentus não publica esse dado para FII hoje —
    // o critério fica fail-open (só reprova quando o número EXISTE e estoura),
    // pronto para o dia em que a ingestão cobrir alavancagem.
    maxLeverage: 30,
    // Papel/CRI só entra se for tier-1. Ao contrário das ações — onde `isTier1`
    // nunca é populada e exigi-la reprovava todo banco (commit 54e62a5) — em FII
    // a flag é curada de verdade: 15 fundos na base, 5 deles de papel.
    requireTier1ForPaper: true,
    // FFO Yield fora desta banda = base de cálculo divergente ou evento não
    // recorrente (CPTR11 128,5%, KOPA11 53,3%…). Tratado como AUSENTE, nunca como
    // nota baixa. 0 significa "a fonte não publicou", não "ruim".
    ffo: Object.freeze({
      minPlausibleYield: 0.5,
      maxPlausibleYield: 30,
      // Cobertura mínima da distribuição pelo FFO (FFO/cota ÷ provento/cota).
      // Abaixo disso o provento não é operacional: vem de ganho de capital ou de
      // amortização, e o fundo está encolhendo para pagar renda. NÃO exclui do
      // universo (a cobertura oscila entre trimestres), mas VETA o COMPRAR — o
      // fundo aparece na lista como AGUARDAR com o motivo explícito. TRXF11
      // distribui 2,5× o próprio FFO (cobertura 0,40x) com DY de 14,8%: é o
      // arquétipo da armadilha de yield que passa em todos os outros filtros.
      minCoverage: 0.7,
    }),
    // Regularidade de distribuição através do ciclo exige série que o
    // FundamentalSnapshot ainda não tem (1 leitura por FII em 22/08/2026, contra
    // TRACK_RECORD_MIN_PERIODS = 6). Enquanto não verifica, não reprova: aplica teto.
    distribution: Object.freeze({ minStreakYears: 5, capWhenUnverified: 85 }),
  }),

  anchorSegments: FII_ANCHOR_SEGMENTS,
  excludedSubTypes: FII_EXCLUDED_SUBTYPES,
  terminationHints: FII_TERMINATION_HINTS,

  // Curadoria fina, editável. allowTickers força inclusão em segmento limítrofe
  // (ex.: um bom fundo rotulado 'Multicategoria'); denyTickers barra nomes
  // específicos mesmo que passem no quant.
  allowTickers: Object.freeze([]),
  denyTickers: Object.freeze([]),

  // Durabilidade do imóvel/inquilino manda. Consistência entra com peso menor na
  // Fase 1 (série de fundamentos dormente) e sobe quando o track record acordar.
  // Valuation NÃO é peso positivo — é freio.
  weights: Object.freeze({ durability: 0.45, resilience: 0.35, consistency: 0.20 }),

  /**
   * FREIO de preço. O preço justo genérico de FII (VP × (1 + (DY − NTN-B)/100))
   * é tautológico: com o setor a P/VP 0,70–0,95, 100% dos elegíveis aparecem
   * "dentro do valor justo" e o freio nunca frita. Aqui o freio é próprio, com
   * dois eixos independentes — qualquer um deles segura o BUY:
   *
   *  1. SPREAD de DY contra a NTN-B longa, com banda. Dentro da banda não
   *     penaliza. Abaixo do piso = comprimido = caro (força WAIT). Acima do teto
   *     NÃO é barganha: é prêmio de risco/armadilha de yield — penaliza pontos,
   *     mas não é "caro".
   *  2. P/FFO (múltiplo padrão do setor imobiliário desde a definição do Nareit
   *     em 1991), derivado do FFO Yield saneado.
   */
  entry: Object.freeze({
    spread: Object.freeze({
      minBand: 2.0, // pp acima da NTN-B longa
      maxBand: 6.0,
      fullPenaltyWhenCompressedAt: -1.0, // DY abaixo da própria NTN-B: penalidade cheia
      fullPenaltyWhenStretchedAt: 12.0,
    }),
    pFfo: Object.freeze({ fair: 16, fullPenaltyAt: 26 }),
    maxPenalty: 25,
  }),

  // Concentração por gestora no ranking final: o 3º fundo da mesma casa perde
  // pontos, o 4º+ perde muito. Espelha a penalidade pós-draft do portfolioEngine.
  concentration: Object.freeze({ maxPerManager: 2, thirdPenalty: 10, overflowPenalty: 20 }),
});
