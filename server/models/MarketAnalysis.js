import mongoose from 'mongoose';

const RankingItemSchema = new mongoose.Schema({
  position: Number,
  ticker: String,
  name: String,
  sector: String, // Novo: Para diversificação
  action: { type: String, enum: ['BUY', 'WAIT', 'SELL'] },
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
    
    // Qualidade & Crescimento
    roe: Number,
    roa: Number, // Novo
    revenueGrowth: Number, // Novo
    netMargin: Number, // Novo
    debtToEquity: Number,
    currentRatio: Number,
    altmanZScore: Number,
    
    // Dividendos
    dy: Number,
    
    // Risco & Técnico
    sharpeRatio: Number,
    volatility: Number,
    rsi: Number, // Novo
    priceVsSMA200: Number // Novo (% acima/abaixo da média de 200)
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