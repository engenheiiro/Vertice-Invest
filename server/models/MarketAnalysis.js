
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
  auditLog: [{
    factor: String,
    points: Number,
    type: { type: String, enum: ['base', 'bonus', 'penalty'] },
    category: String
  }],
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
  isReportPublished: { type: Boolean, default: false },
  isExplainableAIPublished: { type: Boolean, default: false },

  comparisonReport: { type: mongoose.Schema.Types.Mixed, default: null },
  explainableAIPrompt: { type: String, default: '' },
  generatedExplainableAI: { type: String, default: '' },
  // Narrativa Explainable IA por perfil (Defensivo/Moderado/Arrojado). Permite
  // texto aprimorado específico por perfil; o campo único acima é o fallback.
  generatedExplainableAIByProfile: {
    DEFENSIVE: { type: String, default: '' },
    MODERATE: { type: String, default: '' },
    BOLD: { type: String, default: '' },
  },

  content: {
    morningCall: { type: String, default: "" },
    ranking: [RankingItemSchema], 
    fullAuditLog: [RankingItemSchema]
  },
  
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

MarketAnalysisSchema.index({ assetClass: 1, strategy: 1, createdAt: -1 });

// (5.7) TTL: a coleção crescia para sempre (o pipeline grava uma análise por run).
// Expira apenas RASCUNHOS não publicados após 90 dias — relatórios publicados
// (isRankingPublished:true) são o histórico canônico (ranking/accuracy) e ficam.
// partialFilterExpression mantém o TTL restrito aos não publicados.
MarketAnalysisSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 90,
    partialFilterExpression: { isRankingPublished: false },
  }
);

const MarketAnalysis = mongoose.models.MarketAnalysis || mongoose.model('MarketAnalysis', MarketAnalysisSchema);
export default MarketAnalysis;
