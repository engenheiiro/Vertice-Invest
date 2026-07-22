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
    maxBeta: 1.0, // âncora não pode ser mais volátil que o mercado
    minAvgLiquidity: 5_000_000, // R$ 5 M/dia
    minRoe: 10, // rentabilidade mínima através do ciclo (roeTtm p/ banco, roe senão)
    maxNetDebtEbitda: 3.0, // alavancagem operacional
    bank: Object.freeze({ requireTier1: true, minCapitalRatio: 13 }),
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
