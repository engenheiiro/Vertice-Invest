
import mongoose from 'mongoose';

const RankingItemSchema = new mongoose.Schema({
  position: Number,
  previousPosition: Number, // Novo campo para delta
  ticker: String,
  name: String,
  sector: String,
  type: String, 
  action: { type: String, enum: ['BUY', 'WAIT', 'SELL'] },
  currentPrice: Number, 
  targetPrice: Number,
  score: Number,       
  probability: Number, 
  
  riskProfile: { type: String, enum: ['DEFENSIVE', 'MODERATE', 'BOLD'], default: 'MODERATE' },

  thesis: String, 
  bullThesis: [String], 
  bearThesis: [String], 
  
  reason: String,
  metrics: {
    grahamPrice: Number,
    bazinPrice: Number,
    pegRatio: Number,
    pl: Number,
    pvp: Number,
    evEbitda: Number, 
    psr: Number,
    earningsYield: Number,
    pEbit: Number,
    pAtivos: Number,
    pCapGiro: Number,
    pAtivCircLiq: Number,
    evEbit: Number,
    roe: Number,
    roic: Number, 
    netMargin: Number,
    ebitMargin: Number, 
    debtToEquity: Number,
    currentRatio: Number,
    patrimLiq: Number, 
    marketCap: Number,    
    netDebt: Number,      
    netRevenue: Number,   
    netIncome: Number,    
    totalAssets: Number,  
    dy: Number,
    vacancy: Number, 
    qtdImoveis: Number,
    capRate: Number, 
    ffoYield: Number, 
    vpCota: Number, 
    ffoCota: Number, 
    priceM2: Number, 
    rentM2: Number,  
    avgLiquidity: Number,
    revenueGrowth: Number,
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
