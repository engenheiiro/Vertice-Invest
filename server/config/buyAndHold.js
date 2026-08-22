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
 * RAMPA de beta dentro do portão — escala ABSOLUTA, igual para todo arquétipo.
 *
 * O teto é degrau por natureza (segurança é portão: quem passa disputa, quem
 * não passa some). Mas dentro da faixa permitida o beta deixa de ser binário:
 * o ativo é notado numa rampa que vai de `best` (ótimo) até `worst` (pior beta
 * admissível em qualquer canto do universo âncora), no eixo de resiliência.
 * Assim um banco em 1,19 não pontua igual a um em 1,02, e a fronteira para de
 * ser a única coisa que distingue os dois — que era o defeito V-10 do estudo.
 *
 * A rampa NASCEU ancorada no teto do arquétipo (0,60 → 1,00 para operacional,
 * 0,80 → 1,20 para banco), "para se calibrar sozinha". Ancorar assim mede
 * distância até a própria fronteira administrativa, e isso inverte a ordem de
 * risco entre arquétipos. O par que expôs a inversão (medição de 22/08/2026):
 *
 *   ITSA4  beta 0,923  teto 1,00 (DIVERSIFIED_HOLDING)  →  nota 19
 *   ITUB4  beta 1,108  teto 1,20 (BANK)                 →  nota 23
 *
 * A Itaúsa tem beta MENOR e tirava nota MENOR. Ela é, em substância,
 * majoritariamente Itaú dentro de um invólucro: o modelo cobrava da holding a
 * volatilidade do ativo que ela carrega e perdoava a mesma volatilidade no
 * ativo. Não é tese, é artefato de ancoragem — e nem é específico da Itaúsa: com
 * escala por arquétipo, QUALQUER par de arquétipos com tetos diferentes pode
 * inverter, porque a nota deixa de falar de risco e passa a falar de folga
 * regulatória.
 *
 * Beta é a única métrica do eixo medida do mesmo jeito para todo emissor —
 * mesma unidade, mesmo significado, mesma janela. Basileia, solvência e
 * DL/EBITDA precisam de escala por arquétipo porque são grandezas diferentes
 * entre si; beta não precisa, e normalizá-lo por arquétipo inventa uma
 * incomparabilidade que o dado não tem. Todos os 17 elegíveis disputam UMA
 * lista: um componente que só vale dentro do grupo corrompe a ordem entre grupos.
 *
 * A tolerância a banco continua existindo — mas onde ela pertence, no PORTÃO
 * (BANK_MAX_BETA). Admitir é uma decisão; notar é outra. O banco entra na
 * disputa e entra carregando a volatilidade que realmente tem.
 *
 * `worst` acompanha o teto mais alto do universo (hoje o dos bancos): abaixo
 * dele a nota clampa em 0 e o arquétipo mais tolerante perderia a rampa inteira.
 * Um teto novo acima de `worst` derruba um teste, em vez de degradar em silêncio.
 * `best` = 0,60 preserva a âncora de "ótimo" que a largura de 0,40 já usava.
 */
export const BETA_SCALE = Object.freeze({ best: 0.60, worst: BANK_MAX_BETA });

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
    // Ver BETA_SCALE: o teto acima é tolerância de ADMISSÃO (por arquétipo); a
    // nota de beta roda numa escala única para todos, senão a folga do arquétipo
    // é concedida duas vezes e a ordem de risco entre arquétipos inverte.
    betaScale: BETA_SCALE,
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

  // Janela de medição do eixo de CONSISTÊNCIA. O drawdown só é comparável entre
  // ativos se todos forem medidos no mesmo período — ver maxDrawdownPct em
  // services/buyAndHoldService.js, onde a janela desigual fazia a Itaúsa parecer
  // o ativo mais instável do universo por ter série mais funda que os pares.
  // `windowCandles` casa com ASSET_HISTORY_MAX_POINTS (400), a profundidade que
  // 343 dos 362 documentos de STOCK realmente têm; `minCandles` é o piso de
  // cobertura abaixo do qual o drawdown vira AUSENTE em vez de nota.
  consistency: Object.freeze({ drawdownWindowCandles: 400, drawdownMinCandles: 250 }),

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
