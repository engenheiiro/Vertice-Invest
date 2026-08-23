
import mongoose from 'mongoose';

const RankingItemSchema = new mongoose.Schema({
  position: Number,
  previousPosition: Number, // Novo campo para delta
  ticker: String,
  name: String,
  sector: String,
  type: String,
  // Classe econômica, distinta do veículo/moeda (ex.: IVVB11 = ETF/BRL/STOCK_US).
  allocationClass: { type: String, enum: ['STOCK', 'FII', 'STOCK_US', 'CRYPTO', 'FIXED_INCOME', 'CASH', 'OURO', null], default: null },
  currency: { type: String, enum: ['BRL', 'USD', null], default: null },
  // Sub-tipo de Exterior (STOCK_US): STOCK | ETF | REIT | DOLLAR. Propagado do
  // MarketAsset para permitir sub-filtros no Research e viés por sub-meta no rebalance.
  usSubType: { type: String, enum: ['STOCK', 'ETF', 'REIT', 'DOLLAR', 'GOLD', null], default: null },
  action: { type: String, enum: ['BUY', 'WAIT', 'SELL'] },
  currentPrice: Number, 
  targetPrice: Number,
  score: Number,       
  probability: Number, 
  
  // ANCHOR é o perfil ÚNICO da estratégia BUY_AND_HOLD (lista âncora): ela não
  // tem os três perfis do Research semanal, e forçá-la a um deles mentiria sobre
  // o que a lista é. Valor adicional — nenhum documento legado muda.
  riskProfile: { type: String, enum: ['DEFENSIVE', 'MODERATE', 'BOLD', 'ANCHOR'], default: 'MODERATE' },

  thesis: String, 
  auditLog: [{
    factor: String,
    points: Number,
    type: { type: String, enum: ['base', 'bonus', 'penalty', 'info'] },
    category: String
  }],
  bullThesis: [String], 
  bearThesis: [String], 
  // A IA apenas sinaliza risco extraordinário; não altera a action quantitativa.
  riskVeto: {
    active: { type: Boolean, default: false },
    level: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'LOW' },
    rationale: { type: String, default: '' },
    source: { type: String, default: 'GEMINI' },
    evaluatedAt: { type: Date, default: null },
  },
  // Compatibilidade de leitura com clientes/admin legados.
  aiMetadata: {
    riskLevel: { type: String, default: 'LOW' },
    rationale: { type: String, default: '' },
    vetoed: { type: Boolean, default: false },
  },
  
  reason: String,
  // Evidência administrativa da calibração buy-and-hold STOCK. Mixed mantém o
  // contrato versionado sem expor eixos internos como um segundo ranking público.
  stockCalibration: { type: mongoose.Schema.Types.Mixed, default: null },
  coverage: { type: mongoose.Schema.Types.Mixed, default: null },
  // Payload da estratégia âncora (BUY_AND_HOLD): eixos durabilidade/resiliência/
  // consistência, prêmio sobre o preço justo, estado da histerese e motivo de
  // saída. Mixed pelo mesmo motivo de stockCalibration — é um contrato versionado
  // de UMA estratégia, e tipá-lo aqui obrigaria o schema do semanal a conhecê-lo.
  // Null em todo item do ranking legado.
  anchor: { type: mongoose.Schema.Types.Mixed, default: null },
  // Retenção de assento do semanal (BUY_HOLD): marca o item que só está na lista
  // porque já estava, e guarda de onde ele veio. Mixed pelo mesmo motivo de
  // `anchor` — é um contrato versionado, e tipá-lo aqui obrigaria o schema a
  // conhecê-lo. Null em todo item que entrou pelo draft normal.
  //
  // ATENÇÃO: `action` NÃO vive aqui e nunca deve viver. Ela continua derivada do
  // score (score >= 70 ⇔ COMPRAR); um retido abaixo de 70 é AGUARDAR na lista.
  retention: { type: mongoose.Schema.Types.Mixed, default: null },
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
    // Séries temporais (worker): usadas no scoring (via dados vivos) mas antes NÃO
    // declaradas aqui — o Mongoose as descartava no save, então o ranking persistido
    // não as tinha. Consequência: o Comparador exibia "Beta" e "Volatilidade" como
    // "N/A" para todo ativo. Declaradas para persistirem e alimentarem a UI.
    volatility: Number,
    beta: Number,
    sma200: Number,
    ema50: Number,
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
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'ResearchBatch', default: null, index: true },
  runId: { type: String, default: null, index: true },
  parentAnalysis: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketAnalysis', default: null },
  revision: { type: Number, default: 1 },
  algorithmVersion: { type: String, default: 'unknown' },
  inputManifest: { type: mongoose.Schema.Types.Mixed, default: {} },
  calculatedAt: { type: Date, default: Date.now },
  
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

  // Quem SAIU da lista âncora nesta apuração, com motivo legível. Vive no
  // documento (e não só no item) porque o caso mais importante é o ticker que
  // desapareceu do ranking inteiro por ter perdido o portão: ele não tem item
  // onde morar. Uma âncora que some sem explicação é pior que uma que fica —
  // o assinante montou posição com base nela. Vazio para a estratégia legada.
  anchorExits: [{
    ticker: String,
    name: String,
    reason: String,
    score: { type: Number, default: null },
    previousScore: { type: Number, default: null },
    stillListed: { type: Boolean, default: false },
  }],

  // Quem perdeu o ASSENTO no ranking semanal nesta apuração, com motivo legível.
  // Mesmo desenho (e mesmo motivo) de `anchorExits`: vive no documento, e não no
  // item, porque o caso que mais precisa de explicação é justamente o ticker que
  // sumiu da lista inteira — ele não tem item onde morar. Vazio na âncora.
  retentionExits: [{
    ticker: String,
    name: String,
    reason: String,
    // Código do desfecho (RETENTION_OUTCOMES) — para agregar sem parsear texto.
    outcome: String,
    score: { type: Number, default: null },
    previousScore: { type: Number, default: null },
  }],

  content: {
    morningCall: { type: String, default: "" },
    ranking: [RankingItemSchema], 
    fullAuditLog: [RankingItemSchema]
  },
  
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  publication: {
    rankingAt: { type: Date, default: null },
    morningCallAt: { type: Date, default: null },
    reportAt: { type: Date, default: null },
    explainableAIAt: { type: Date, default: null },
  },
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
