
import mongoose from 'mongoose';

const RankingItemSchema = new mongoose.Schema({
  position: Number,
  ticker: String,
  name: String,
  sector: String,
  type: String, 
  action: { type: String, enum: ['BUY', 'WAIT', 'SELL'] },
  currentPrice: Number, 
  targetPrice: Number,
  score: Number,       
  probability: Number, 
  
  // Campo Essencial para as Abas
  riskProfile: { type: String, enum: ['DEFENSIVE', 'MODERATE', 'BOLD'], default: 'MODERATE' },

  // Teses Estruturadas
  thesis: String, // Resumo curto
  bullThesis: [String], // Pontos positivos detalhados
  bearThesis: [String], // Riscos detalhados
  
  reason: String,
  metrics: {
    // Valuation Clássico
    grahamPrice: Number,
    bazinPrice: Number,
    pegRatio: Number,
    pl: Number,
    pvp: Number,
    evEbitda: Number, 
    psr: Number,
    earningsYield: Number,
    
    // Valuation Avançado (Novos)
    pEbit: Number,
    pAtivos: Number,
    pCapGiro: Number,
    pAtivCircLiq: Number,
    evEbit: Number,

    // Rentabilidade e Eficiência
    roe: Number,
    roic: Number, 
    netMargin: Number,
    ebitMargin: Number, 
    
    // Saúde Financeira
    debtToEquity: Number,
    currentRatio: Number,
    
    // Dados de Balanço (Disponíveis no Bulk)
    patrimLiq: Number, 
    
    // Dados Calculados (Engenharia Reversa)
    marketCap: Number,    // Valor de Mercado
    netDebt: Number,      // Dívida Líquida
    netRevenue: Number,   // Receita Líquida
    netIncome: Number,    // Lucro Líquido
    totalAssets: Number,  // Ativos Totais
    
    // Dividendos
    dy: Number,
    
    // FIIs Específico Detalhado
    vacancy: Number, 
    qtdImoveis: Number,
    capRate: Number, 
    ffoYield: Number, 
    vpCota: Number, 
    ffoCota: Number, 
    priceM2: Number, 
    rentM2: Number,  
    
    // Dados Brutos
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
