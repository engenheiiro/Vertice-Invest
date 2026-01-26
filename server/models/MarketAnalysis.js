
import mongoose from 'mongoose';

const RankingItemSchema = new mongoose.Schema({
  position: Number,
  ticker: String,
  name: String,
  sector: String,
  type: String, // Novo campo para identificar classe (STOCK, FII, CRYPTO)
  action: { type: String, enum: ['BUY', 'WAIT', 'SELL'] },
  currentPrice: Number, 
  targetPrice: Number,
  score: Number,       
  probability: Number, 
  thesis: String,      
  reason: String,
  metrics: {
    // Valuation
    grahamPrice: Number,
    bazinPrice: Number,
    pegRatio: Number,
    pl: Number,
    pvp: Number,
    earningsYield: Number,
    
    // Dados Brutos
    eps: Number,
    bvps: Number,
    divPerShare: Number,
    avgLiquidity: Number,

    // Qualidade & Crescimento
    roe: Number,
    roa: Number,
    revenueGrowth: Number,
    netMargin: Number,
    debtToEquity: Number,
    currentRatio: Number,
    altmanZScore: Number,
    
    // Dividendos
    dy: Number,
    
    // Risco & Técnico
    sharpeRatio: Number,
    volatility: Number,
    rsi: Number,
    priceVsSMA200: Number,

    // --- NOVO: Scores Estruturais ---
    structural: {
        quality: { type: Number, default: 50 },
        valuation: { type: Number, default: 50 },
        risk: { type: Number, default: 50 }
    }
  }
});

const MarketAnalysisSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  assetClass: { type: String, required: true },
  strategy: { type: String, required: true },
  
  isRankingPublished: { type: Boolean, default: false },
  isMorningCallPublished: { type: Boolean, default: false },

  content: {
    morningCall: { type: String, default: "" },
    ranking: [RankingItemSchema], 
    fullAuditLog: [RankingItemSchema]
  },
  
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

MarketAnalysisSchema.index({ assetClass: 1, strategy: 1, createdAt: -1 });

const MarketAnalysis = mongoose.models.MarketAnalysis || mongoose.model('MarketAnalysis', MarketAnalysisSchema);
export default MarketAnalysis;
