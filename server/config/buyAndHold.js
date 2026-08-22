/**
 * Configuração do ranking "Buy-and-Hold" (estratégia BUY_AND_HOLD).
 *
 * Produto: lista de ativos SEGUROS para carregar por muitos anos (âncora). A
 * segurança é um PORTÃO (setor curado + filtros quantitativos), não um score:
 * quem não passa no portão nunca aparece como BUY, por mais barato que esteja.
 *
 * Distinto da estratégia legada `BUY_HOLD` (ranking de 3 perfis), que permanece
 * intocada. Este módulo é data-only; a lógica vive em
 * server/services/engines/buyAndHoldEngine.js.
 *
 * Os thresholds são pontos de partida tunáveis (futuramente via configService,
 * sem deploy). Ver planejamento/DESIGN-BUY-AND-HOLD-2026-07-20.md.
 */

export const BUY_AND_HOLD_VERSION = 'BH_V1';

/**
 * Teto de beta dos BANCOS — UMA constante nomeada, trivial de flipar.
 *
 * Banco brasileiro tem beta estruturalmente acima de 1 porque é proxy do ciclo
 * econômico local. Cobrar dele o mesmo teto de uma transmissora de energia não
 * é rigor, é comparar coisas diferentes: com `maxBeta` 1,00 valendo para todo
 * mundo, TODO banco grande do país ficava fora do universo âncora — os seis
 * falhavam por um único motivo, literalmente "beta acima de 1", nenhum por
 * fundamento (medição de 22/08/2026 contra a base de produção):
 *
 *   BRSR6 1,0110 · BBAS3 1,0663 · ITUB4 1,1079 · SANB11 1,1506 · BBDC4 1,2717
 *   · BPAC11 1,4762   (todos com Basileia >= 13 e ROE recorrente >= 10)
 *
 * 1,20 deixa entrar BRSR6, BBAS3, ITUB4 e SANB11; mantém fora BBDC4 e BPAC11.
 *
 * Por que NÃO 1,15: SANB11 está em 1,1506 e cairia fora por seis milésimos —
 * o defeito V-10 do estudo de maturidade (degraus em vez de rampas) se
 * materializando num número escolhido por acidente.
 *
 * BPAC11 fica fora por beta, mas o motivo certo seria outro: BTG Pactual é
 * banco de investimento, não franquia de depósitos. Se um dia o teto subir a
 * ponto de deixá-lo entrar, barre por modelo de negócio (denyTickers), não por
 * volatilidade.
 *
 * Passar no portão não faz banco virar COMPRAR — só devolve o direito de
 * disputar. O freio de preço e o threshold de 70 continuam valendo.
 */
export const BANK_MAX_BETA = 1.20;

/**
 * Largura da RAMPA de beta dentro do portão, em unidades de beta.
 *
 * O teto é degrau por natureza (segurança é portão: quem passa disputa, quem
 * não passa some). Mas dentro da faixa permitida o beta deixa de ser binário:
 * o ativo é notado numa rampa que vai de `teto − largura` (ótimo) até o próprio
 * teto (pior admissível), no eixo de resiliência. Assim um banco em 1,19 não
 * pontua igual a um em 1,02, e a fronteira para de ser a única coisa que
 * distingue os dois.
 *
 * A rampa é ancorada no teto do ARQUÉTIPO, então ela se calibra sozinha: 0,60 →
 * 1,00 para operacional, 0,80 → 1,20 para banco. Beta baixo para o próprio
 * arquétipo é que vale nota alta.
 */
export const BETA_RAMP_WIDTH = 0.40;

// Sub-setores (rótulo fino do ativo) elegíveis como buy-and-hold. Normalizados
// (sem acento, minúsculo) no engine. Macro-setor é grosseiro demais aqui: colapsa
// Telecom com tech de crescimento e consumo básico com varejo cíclico. Curamos
// o rótulo fino para deixar entrar só receita previsível/defensiva.
export const ANCHOR_SECTORS = Object.freeze([
  // Utilities reguladas / contratadas
  'eletricas', 'energia eletrica', 'transmissao', 'geracao de energia',
  'saneamento', 'agua e saneamento', 'gas', 'utilidade publica',
  // Telecom (infra essencial)
  'telecom', 'telecomunicacoes',
  // Seguros de qualidade
  'seguros', 'previdencia e seguros', 'seguradoras',
  // Bancos (ainda passam pelo gate tier-1 no engine)
  'bancos',
  // Consumo básico (staples)
  'alimentos', 'bebidas',
]);

export const BUY_AND_HOLD_CONFIG = Object.freeze({
  version: BUY_AND_HOLD_VERSION,

  gate: Object.freeze({
    minMarketCap: 5_000_000_000, // R$ 5 bi — piso de estabilidade/porte
    maxBeta: 1.0, // padrão: âncora não pode ser mais volátil que o mercado
    // Teto por ARQUÉTIPO, sobrepondo o padrão. Ver BANK_MAX_BETA: aplicar o teto
    // de uma transmissora a um banco não é rigor, é comparar coisas diferentes.
    // Só BANK diverge hoje; seguradora e operacional seguem em 1,00.
    maxBetaByArchetype: Object.freeze({ BANK: BANK_MAX_BETA }),
    betaRampWidth: BETA_RAMP_WIDTH, // ver BETA_RAMP_WIDTH: dentro do portão, rampa
    minAvgLiquidity: 5_000_000, // R$ 5 M/dia
    minRoe: 10, // rentabilidade mínima através do ciclo (roeTtm p/ banco, roe senão)
    maxNetDebtEbitda: 3.0, // alavancagem operacional
    // Banco: qualidade medida por número, não por curadoria. `requireTier1` exigia a
    // flag `isTier1`, que só é populada para uma lista de FIIs de elite e dez mega caps
    // US — nenhum banco brasileiro jamais recebia `true`, então TODOS eram reprovados
    // ("banco não tier-1"). Um ranking âncora de aposentadoria no Brasil sem banco algum
    // era artefato de implementação, não tese. Basileia e ROE recorrente vêm do IF.data
    // do BCB (sectorMetrics) e são observáveis para todo emissor mapeado.
    bank: Object.freeze({ minCapitalRatio: 13, minRoeTtm: 10 }),
    insurer: Object.freeze({ minSolvency: 130, maxCombined: 100 }),
    dividend: Object.freeze({
      minStreakYears: 5, // dividendo pago em todos os últimos N anos
      // Enquanto a série (AssetHistory, ~1,6 ano) não permite verificar o streak
      // plurianual, o ativo não é auto-reprovado: recebe teto de confiança.
      capWhenUnverified: 85,
    }),
  }),

  anchorSectors: ANCHOR_SECTORS,

  // Curadoria fina, editável. allowTickers força inclusão em setor limítrofe;
  // denyTickers barra nomes específicos (governança/histórico) mesmo que passem
  // no quant. Controle estatal NÃO é barrado por padrão (penaliza resiliência).
  allowTickers: Object.freeze([]),
  denyTickers: Object.freeze([]),

  // Durabilidade e resiliência mandam; consistência entra com peso menor na Fase 1
  // (série ainda amadurecendo) e sobe na Fase 2. Valuation não é peso positivo.
  weights: Object.freeze({ durability: 0.50, resilience: 0.35, consistency: 0.15 }),

  // Valuation como FREIO: dentro do valor justo (+tolerância) não penaliza; caro
  // subtrai até maxPenalty e força WAIT. Nunca adiciona pontos.
  entry: Object.freeze({ fairValueTolerance: 0.05, maxPenalty: 25, penaltyFullAtPremium: 0.5 }),
});
