/**
 * Configuração da RETENÇÃO DE ASSENTO do ranking semanal (`BUY_HOLD`).
 *
 * Data-only e congelada; a lógica vive em `server/utils/weeklyRetention.js`
 * (função pura) e é plugada em `aiResearchService.calculateRanking` /
 * `buildBrasil10`.
 *
 * ── A DISTINÇÃO QUE JUSTIFICA ESTE MÓDULO ──────────────────────────────────
 *
 * `score >= 70 ⇔ COMPRAR` é contrato de todo o sistema e NÃO é flexibilizado
 * aqui. O que este módulo altera é o ASSENTO — quem aparece na lista, hoje
 * decidido puramente pelo draft competitivo do instante — e nunca a AÇÃO, que
 * segue derivada do score por `deriveRankingAction`.
 *
 *   | O quê    | Quem decide             | A retenção age? |
 *   |----------|-------------------------|-----------------|
 *   | Assento  | draft competitivo       | Sim             |
 *   | Ação     | deriveRankingAction()   | Nunca           |
 *
 * Um incumbente retido com score 65 continua na lista, rotulado AGUARDAR. Isso
 * é deliberadamente DIFERENTE da estratégia âncora (`anchorHysteresis.js`), que
 * mantém COMPRAR na banda de permanência declarando `HELD` — lá o contrato de
 * ranking é outro (ver RANKING_CONTRACTS em utils/rankingContract.js).
 *
 * ── POR QUE ────────────────────────────────────────────────────────────────
 *
 * Achado V-01 do estudo de maturidade: em 40 publicações / 90 dias o Brasil 10
 * passou por 34 tickers distintos numa lista de dez, sem nenhum presente em
 * todas. Decompondo o giro medido em 23/08/2026, o Brasil 10 teve 112 trocas de
 * ASSENTO contra 1 troca de AÇÃO; FII ~10:1; ações ~2,6:1. Ou seja: quase todo
 * o giro da lista mais visível do produto é assento — exatamente o que a
 * retenção conserta, sem encostar na regra do 70.
 */

/** Piso de permanência: mesmo valor da âncora, de propósito. */
const HOLD_SCORE = 62;

export const WEEKLY_HYSTERESIS = Object.freeze({
  /**
   * Piso de permanência do assento. Igual ao `holdScore` da âncora
   * (ANCHOR_HYSTERESIS.holdScore) por decisão de produto: duas bandas
   * diferentes no mesmo produto seriam duas explicações diferentes para o
   * assinante. 8 pontos de folga sobre o limiar de 70 — larga o bastante para o
   * ruído de medição observado (1 a 5 pontos), apertada o bastante para não
   * segurar uma deterioração real.
   */
  holdScore: HOLD_SCORE,

  /**
   * GUARD-RAIL. Teto de readmissões por classe por apuração, como fração dos
   * assentos (9 de 30, 3 de 10). Sem ele, uma base degradada (sync parcial,
   * fonte fora do ar) congelaria a lista inteira em incumbentes e o ranking
   * pararia de responder ao mercado. Estourar o teto é warn + Sentry.
   */
  maxRetentionShare: 0.30,

  /**
   * Teto de ativos por balde de concentração que a readmissão respeita.
   * Espelha o `MAX_PER_SECTOR_FLEX` do draft (portfolioEngine) — que é o teto
   * MAIS PERMISSIVO que o draft usa. Readmitir acima disso deixaria a retenção
   * montar uma concentração que o próprio draft recusaria montar.
   */
  sectorCap: 3,

  /**
   * Onde ligar. A tabela de decomposição do giro diz onde a retenção tem efeito:
   *  - BRASIL_10 / STOCK / FII → giro dominado por assento (112:1, 2,6:1, ~10:1);
   *  - REIT e ETF → 0 e 21 trocas de assento, universo praticamente fixo;
   *  - CRYPTO → os flips são reprecificações reais de 30+ pontos, devem passar;
   *  - STOCK_US → giro alto, mas é a classe com mais flips perto do limiar;
   *    entra depois de trocar os degraus do scorer por rampas.
   * Ligar STOCK_US depois é trocar esta constante, não espalhar `if`.
   */
  enabledClasses: Object.freeze(['BRASIL_10', 'STOCK', 'FII']),

  /**
   * `true` = MEDE e não age (a retenção é calculada, logada e persistida em
   * `inputManifest.retentionAudit`, mas o ranking publicado é o do draft).
   * `false` = a retenção decide os assentos de verdade.
   *
   * LIGADA em 23/08/2026, com o número do `auditWeeklyRetentionShadow` na mão:
   *   - BRASIL_10, 39 transições replicadas: Jaccard mediano 0,818 → 1,000
   *     (média 0,783 → 0,890), 34 → 28 tickers distintos, 75 retenções;
   *   - apuração do dia, sem aproximação: BRASIL_10 0,818 → 1,000 (retém ABCB4
   *     em 77, COMPRAR); STOCK 0,765 → 0,818 (retém COGN3 caindo de 73 para 67,
   *     publicado AGUARDAR — a regra do 70 intacta);
   *   - zero itens com COMPRAR e score < 70 em qualquer classe replicada.
   *
   * Voltar para `true` desliga a retenção sem remover nada: a auditoria continua
   * sendo calculada e persistida, e a lista volta a ser a do draft puro.
   */
  shadow: false,
});

/** True se a classe está na lista de retenção. */
export const isWeeklyRetentionEnabled = (assetClass, config = WEEKLY_HYSTERESIS) => (
  (config.enabledClasses || []).includes(assetClass)
);

/**
 * Teto de readmissões para um pool de `seats` assentos. `floor` de propósito:
 * com 10 assentos o teto é 3, com 30 é 9 — nunca arredonda para cima, porque o
 * guard-rail existe para ser conservador.
 */
export const weeklyRetentionBudget = (seats, config = WEEKLY_HYSTERESIS) => (
  Math.floor(Math.max(0, Number(seats) || 0) * config.maxRetentionShare)
);
