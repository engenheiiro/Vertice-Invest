
import mongoose from 'mongoose';

const MarketAssetSchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED_INCOME', 'CASH'], 
    required: true 
  },
  currency: { type: String, enum: ['BRL', 'USD'], default: 'BRL' },
  
  // --- Metadados de Análise ---
  sector: { type: String, default: 'Geral' }, 
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
  failCount: { type: Number, default: 0 }, // Contador de falhas consecutivas de sync

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

  lastAnalysisDate: { type: Date },
  updatedAt: { type: Date, default: Date.now }
});

MarketAssetSchema.index({ type: 1, isActive: 1 });

const MarketAsset = mongoose.models.MarketAsset || mongoose.model('MarketAsset', MarketAssetSchema);
export default MarketAsset;
