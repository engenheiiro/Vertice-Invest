
import mongoose from 'mongoose';

const AlgorithmPerformanceSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now }, // Data da execução do teste
  assetClass: { type: String, required: true }, // STOCK, FII, etc.
  
  // Janela de Tempo Analisada (ex: "Recomendação feita há 30 dias")
  lookbackWindow: { type: Number, required: true }, // 30, 60, 90 dias
  
  // Performance
  avgReturn: { type: Number, required: true }, // Retorno médio do Top Picks
  benchmarkReturn: { type: Number, default: 0 }, // Legado — alias para ibovReturn
  ibovReturn: { type: Number, default: 0 },
  spxReturn: { type: Number, default: 0 },
  cdiReturn: { type: Number, default: 0 },
  ifixReturn: { type: Number, default: 0 },
  alpha: { type: Number, default: 0 }, // Diferença (AvgReturn - benchmark)
  
  // Detalhes
  topPicksSnapshot: [{
    ticker: String,
    startPrice: Number,
    currentPrice: Number,
    returnPercent: Number
  }],
  
  // Métricas de Qualidade
  hitRate: { type: Number }, // % de ativos com retorno positivo
  deviationAlert: { type: Boolean, default: false } // Se houve queda brusca (>15%)
});

// Índices para gráficos rápidos
AlgorithmPerformanceSchema.index({ date: 1, assetClass: 1 });

const AlgorithmPerformance = mongoose.models.AlgorithmPerformance || mongoose.model('AlgorithmPerformance', AlgorithmPerformanceSchema);
export default AlgorithmPerformance;
