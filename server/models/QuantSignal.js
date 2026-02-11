
import mongoose from 'mongoose';

const QuantSignalSchema = new mongoose.Schema({
  ticker: { type: String, required: true, index: true },
  assetType: { type: String, enum: ['STOCK', 'FII', 'STOCK_US', 'CRYPTO'], default: 'STOCK' },
  riskProfile: { type: String, enum: ['DEFENSIVE', 'MODERATE', 'BOLD'], default: 'MODERATE' },
  sector: { type: String }, // Novo campo para Heatmap
  
  type: { 
    type: String, 
    required: true, 
    enum: ['RSI_OVERSOLD', 'VOLUME_SPIKE', 'DEEP_VALUE', 'SUPPORT_ZONE'] 
  },
  value: { type: Number, required: true },
  message: { type: String, required: true },
  
  // --- CAMPOS DE AUDITORIA E BACKTEST ---
  priceAtSignal: { type: Number, required: true }, // Preço no momento do sinal
  status: { type: String, enum: ['ACTIVE', 'HIT', 'MISS', 'NEUTRAL'], default: 'ACTIVE' },
  finalPrice: { type: Number }, // Preço no momento do fechamento/auditoria
  resultPercent: { type: Number }, // Resultado final %
  auditDate: { type: Date }, // Data da auditoria

  // Removido index: true daqui pois já existe definição explícita abaixo com TTL
  timestamp: { type: Date, default: Date.now }
});

// TTL Index: Mantém histórico por 90 dias (7776000 segundos) ao invés de 24h
QuantSignalSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });

const QuantSignal = mongoose.models.QuantSignal || mongoose.model('QuantSignal', QuantSignalSchema);
export default QuantSignal;
