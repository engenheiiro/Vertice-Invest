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
 * Pisos calibrados contra a base de produção (371 FIIs não blacklistados) na
 * "configuração B (Equilibrado)" do estudo de maturidade
 * (planejamento/ESTUDO-MATURIDADE-RANKING-2026-08.html). A configuração ampla
 * testada dava 54 nomes, 28 deles de papel: concentração inaceitável em crédito.
 *
 * A CONTAGEM DE ELEGÍVEIS NÃO MORA AQUI. Ela muda a cada sync e envelhece mais
 * rápido que o comentário: a leitura de 28 elegíveis / 19 gestoras registrada
 * neste cabeçalho já estava errada no dia seguinte ao commit — o resgate de
 * vacância implausível (1c0c739) devolveu XPML11 e HSML11 à lista, e a
 * consolidação de prefixos do fiiManagerMap juntou fundos que antes contavam
 * como casas distintas (menos gestoras porque a contagem ficou mais correta,
 * não porque a lista piorou). A fonte de verdade é o script de auditoria:
 *
 *   node server/scripts/auditFiiBuyAndHoldShadowRanking.js
 *
 * Ele imprime analisados/elegíveis/gestoras, a composição da lista de COMPRAR e
 * os motivos de exclusão, sempre contra o estado atual da base. Em 22/08/2026,
 * como referência histórica, ele dava 122 analisados · 30 elegíveis (15
 * gestoras) · 3 COMPRAR.
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
    // O campo "Vacância Média" do Fundamentus não é confiável em toda a base.
    // Conferido contra a página da fonte em 22/08/2026 (a raspagem lê a coluna
    // certa): a própria fonte publica valores impossíveis — EDFO11 100,03%,
    // LKDV11 100,02% — e atribui 91,81% ao XPML11 e 85,82% ao HSML11, dois dos
    // maiores FIIs de shopping do país, ambos com ocupação real acima de 95% e
    // pagando renda normal. O número vem errado de lá, não daqui.
    //
    // Não há como consertá-lo (a fonte não expõe a base de cálculo), então ele é
    // DESCARTADO quando se contradiz — e descartar significa AUSENTE (sem
    // penalidade, sem bônus, com teto de confiança), nunca "vacância zero".
    // O descarte é estreito de propósito: só cai o que é impossível (> 100%) ou
    // o que reporta metade da carteira vazia enquanto paga renda normal, com FFO
    // positivo, em vários imóveis — combinação que não existe no mundo real.
    // Fundo de fato vazio continua barrado: CPOF11 (99,98% com DY 3,19%) e
    // FTCE11 (63% com DY 1,93%) não são resgatados.
    vacancy: Object.freeze({
      maxPossible: 100, // acima disso não é taxa de vacância, é lixo
      implausibleFrom: 50, // metade da carteira vazia…
      minPropertiesForImplausible: 5, // …num fundo multi-imóvel…
      minDyForImplausible: 6, // …que ainda paga renda normal com FFO positivo
      capWhenUnverified: 85,
    }),
    minProperties: 2, // mono-ativo de tijolo não é âncora
    minDy: 4, // sem renda corrente não é âncora de renda
    // Armadilha de yield: acima disso o DY é amortização/evento não recorrente,
    // não renda. Mesmo limiar que o scoringEngine já usa para FII.
    maxDy: FII_YIELD_TRAP_THRESHOLD,
    // Alavancagem (% do PL, lida de `debtToEquity` — o campo que existe no
    // MarketAsset; `leverage` não existe em nenhum documento). O Fundamentus não
    // publica dívida de FII: o campo é 0 em 371 de 371 fundos, e 0 aqui significa
    // "não publicado", não "sem dívida" — por isso entra como AUSENTE, sem virar
    // nota máxima de resiliência. Critério fail-open: só reprova quando o número
    // EXISTE e estoura, pronto para o dia em que a ingestão cobrir alavancagem.
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

  // Janela de medição do drawdown, no eixo de CONSISTÊNCIA. Mesmos valores do
  // motor de ações de propósito: o drawdown só é comparável entre ativos se
  // todos forem medidos no mesmo período, e a profundidade da série no banco é
  // desigual de forma PERMANENTE (a catraca de walletDayCandleService mantém
  // funda a série dos tickers em carteira — entre os FIIs elegíveis, 8 estão
  // acima do cap de 400 e o resto exatamente nele). Ver maxDrawdownPct em
  // utils/assetHistory.js. `minCandles` é o piso abaixo do qual o drawdown vira
  // AUSENTE em vez de nota.
  consistency: Object.freeze({ drawdownWindowCandles: 400, drawdownMinCandles: 250 }),

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

  /**
   * Teto de composição da LISTA PUBLICÁVEL — o subconjunto COMPRAR, não os
   * elegíveis.
   *
   * A penalidade de `concentration` acima incide sobre a lista de elegíveis e
   * por isso nunca morde o topo: em 22/08/2026 ela começava no 3º fundo da casa
   * e os 4 COMPRAR eram KNCR11, KNSC11 (ambos papel, ambos Kinea, 1º e 2º da
   * lista), PMLL11 e HSLG11. Metade crédito e metade Kinea, com a penalidade
   * intacta. Um teto que não morde o topo não é teto.
   *
   * O crédito voltou pela porta do score: o portão B ("Equilibrado") já barra 40
   * fundos de papel fora do tier-1 justamente para não concentrar em crédito,
   * mas papel tem FFO limpo e previsível enquanto tijolo carrega o ruído de
   * vacância da fonte. O portão segurou; o score não.
   *
   * Aqui o excedente NÃO some da lista: vira AGUARDAR com motivo explícito. O
   * fundo continua rastreável, mantém score e posição, e o assinante entende por
   * que ele não subiu — o motivo é composição de carteira, não demérito.
   *
   * Os tetos são FRAÇÕES da lista publicável, não números fixos: com 4 COMPRAR o
   * limite é 1, com 12 é 4. Resolvidos por ponto fixo (demover encurta a lista,
   * o que pode apertar o teto de novo), então a fração vale sobre o resultado
   * final, não sobre a lista de partida — sem isso 8 candidatos de papel para 2
   * de tijolo publicariam 60% de crédito.
   */
  publication: Object.freeze({
    maxPaperShare: 0.34, // crédito no máximo ~1/3 da lista publicável
    maxManagerShare: 0.34, // mesma casa gestora no máximo ~1/3
    minPerBucket: 1, // com lista curta sempre cabe um de cada — 1 nome não é concentração
  }),
});
