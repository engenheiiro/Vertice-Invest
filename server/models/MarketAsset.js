
import mongoose from 'mongoose';

const MarketAssetSchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ['STOCK', 'FII', 'STOCK_US', 'ETF', 'CRYPTO', 'FIXED_INCOME', 'CASH', 'OURO'],
    required: true
  },
  currency: { type: String, enum: ['BRL', 'USD'], default: 'BRL' },
  
  // --- Metadados de Análise ---
  sector: { type: String, default: 'Geral' },
  // Arquétipo econômico explícito para calibração setorial STOCK. `null` mantém
  // compatibilidade e permite classificação shadow por setor/ticker até o backfill.
  stockArchetype: {
    type: String,
    enum: [
      'OPERATIONAL',
      'BANK',
      'INSURER',
      'INSURANCE_BROKER',
      'FINANCIAL_HOLDING',
      'INSURANCE_HOLDING_DISTRIBUTOR',
      'DIVERSIFIED_HOLDING',
      'OIL_GAS_PRODUCER',
      null,
    ],
    default: null
  },
  // Indústria fina do Yahoo (ex.: "REIT - Retail") — usada p/ sub-segmentar REITs na UI
  // sem alterar o `sector` (que a classificação usa p/ identificar REAL_ESTATE).
  industry: { type: String, default: null },
  isIgnored: { type: Boolean, default: false }, 
  isBlacklisted: { type: Boolean, default: false }, 
  isTier1: { type: Boolean, default: false }, 
  
  // --- Dados Financeiros Persistidos (Cache Avançado) ---
  lastPrice: { type: Number, default: 0 },
  change: { type: Number, default: 0 },
  marketCap: { type: Number, default: 0 },
  liquidity: { type: Number, default: 0 }, // Liq. Diária
  
  // Indicadores de Valuation & Eficiência (Stocks)
  pl: { type: Number, default: 0 },
  roe: { type: Number, default: 0 },
  roic: { type: Number, default: 0 },
  netMargin: { type: Number, default: 0 },
  evEbitda: { type: Number, default: 0 },
  revenueGrowth: { type: Number, default: 0 }, // Crescimento 5a
  debtToEquity: { type: Number, default: 0 },
  netDebt: { type: Number, default: 0 },
  payout: { type: Number, default: 0 },
  // Métricas próprias de bancos/seguros/holdings. Ausência permanece `null` —
  // nunca vira zero econômico. Ainda não participa do ranking de produção.
  sectorMetrics: {
    asOf: { type: Date, default: null },
    collectedAt: { type: Date, default: null },
    source: { type: String, default: null },
    sourceDocument: { type: String, default: null },
    supportingDocuments: { type: [String], default: undefined },
    methodologyVersion: { type: String, default: null },
    roeTtm: { type: Number, default: null },
    earningsGrowth: { type: Number, default: null },
    delinquencyRatio: { type: Number, default: null },
    problemAssetsRatio: { type: Number, default: null },
    capitalRatio: { type: Number, default: null },
    capitalPrincipalRatio: { type: Number, default: null },
    operatingCostRatio: { type: Number, default: null },
    creditCost: { type: Number, default: null },
    coverageRatio: { type: Number, default: null },
    liquidityCoverage: { type: Number, default: null },
    recurringEarningsGrowth: { type: Number, default: null },
    solvencyRatio: { type: Number, default: null },
    combinedRatio: { type: Number, default: null },
    claimsRatio: { type: Number, default: null },
    premiumGrowth: { type: Number, default: null },
    cashRemittanceCoverage: { type: Number, default: null },
    capitalAdequacy: { type: Number, default: null },
    investeeCapitalAdequacy: { type: Number, default: null },
    distributionConcentration: { type: Number, default: null },
    distributionRevenueGrowth: { type: Number, default: null },
    commissionRevenueGrowth: { type: Number, default: null },
    partnerConcentration: { type: Number, default: null },
    productionKboed: { type: Number, default: null },
    productionGrowth: { type: Number, default: null },
    liftingCostUsdBoe: { type: Number, default: null },
    liftingCostAsOf: { type: Date, default: null },
    liftingCostBasis: {
      type: String,
      enum: ['REPORTED', 'EX_LEASES', null],
      default: null
    },
    ebitdaMargin: { type: Number, default: null },
    ebitdaBasis: {
      type: String,
      enum: ['REPORTED', 'ADJUSTED', 'ADJUSTED_EX_IFRS16', null],
      default: null
    },
    netDebtEbitda: { type: Number, default: null },
    freeCashFlowMargin: { type: Number, default: null },
    provedReserveLifeYears: { type: Number, default: null },
    reserveReplacementRatio: { type: Number, default: null },
    reserveBasis: {
      type: String,
      enum: ['SEC_1P', 'SPE_1P', null],
      default: null
    },
    controlType: {
      type: String,
      enum: ['PRIVATE', 'STATE_DIRECT', 'STATE_INDIRECT', 'DISPERSED', null],
      default: null
    }
  },
  // Financials LTM (engenharia reversa Fundamentus) — cacheados para preencher
  // lacunas no modal "Financials (LTM)" e carregados como carry-forward.
  netRevenue: { type: Number, default: 0 },
  netIncome: { type: Number, default: 0 },
  totalAssets: { type: Number, default: 0 },
  patrimLiq: { type: Number, default: 0 },
  
  // Indicadores FIIs
  vacancy: { type: Number, default: 0 },
  p_vp: { type: Number, default: 0 },
  dy: { type: Number, default: 0 },
  capRate: { type: Number, default: 0 },
  qtdImoveis: { type: Number, default: 0 },
  
  // --- Séries Temporais (Workers) ---
  volatility: { type: Number, default: 0 },
  beta: { type: Number, default: 0 },
  sma200: { type: Number, default: 0 },
  ema50: { type: Number, default: 0 },
  
  // --- Controle de Saúde do Ativo ---
  isActive: { type: Boolean, default: true },
  failCount: { type: Number, default: 0 }, // Dias distintos com falha de cotação (não falhas por request)
  lastFailDate: { type: Date, default: null }, // Último dia em que uma falha foi contabilizada — gate de 1 falha/dia

  // --- Qualidade e Atualidade dos Dados ---
  // Data em que os dados fundamentalistas foram coletados pela última vez.
  // null = nunca coletado. Usado pelo scoringEngine para penalizar dados antigos.
  lastFundamentalsDate: { type: Date, default: null },

  // Para FIIs: subtipo explícito para evitar detecção frágil por substring no setor.
  // null = não classificado (motor usa fallback por 'sector' como compatibilidade).
  fiiSubType: {
    type: String,
    enum: ['TIJOLO', 'PAPEL', 'HIBRIDO', 'FOF', 'DESENVOLVIMENTO', null],
    default: null
  },

  // Para Exterior (STOCK_US): sub-tipo do ativo internacional, usado para ramificar
  // o ranking (Stocks/ETFs/REITs) e a Carteira Ideal. null = não classificado.
  usSubType: {
    type: String,
    enum: ['STOCK', 'ETF', 'REIT', 'DOLLAR', 'GOLD', null],
    default: null
  },

  lastAnalysisDate: { type: Date },
  updatedAt: { type: Date, default: Date.now }
});

MarketAssetSchema.index({ type: 1, isActive: 1 });
// (M14) Índice do filtro quente de elegibilidade: signalEngine, generateRadarReport,
// scheduler e marketDataService varrem por { isActive, isBlacklisted, isIgnored, type }.
// Campos de igualdade primeiro evitam full collection scan a cada run.
MarketAssetSchema.index({ isActive: 1, isBlacklisted: 1, isIgnored: 1, type: 1 });

const MarketAsset = mongoose.models.MarketAsset || mongoose.model('MarketAsset', MarketAssetSchema);
export default MarketAsset;
