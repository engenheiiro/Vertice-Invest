
import mongoose from 'mongoose';

const QuantSignalSchema = new mongoose.Schema({
  ticker: { type: String, required: true, index: true },
  assetType: { type: String, enum: ['STOCK', 'FII', 'STOCK_US', 'CRYPTO'], default: 'STOCK' },
  riskProfile: { type: String, enum: ['DEFENSIVE', 'MODERATE', 'BOLD'], default: 'MODERATE' },
  sector: { type: String },

  type: {
    type: String,
    required: true,
    enum: ['RSI_OVERSOLD', 'VOLUME_SPIKE', 'DEEP_VALUE', 'SUPPORT_ZONE']
  },

  quality: { type: String, enum: ['GOLD', 'SILVER'], default: 'GOLD' },
  urgencyLevel: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM'], default: 'MEDIUM' },

  value: { type: Number, required: true },
  message: { type: String, required: true },

  // --- CAMPOS DE AUDITORIA E BACKTEST ---
  priceAtSignal: { type: Number, required: true },
  status: { type: String, enum: ['ACTIVE', 'HIT', 'MISS', 'NEUTRAL'], default: 'ACTIVE' },
  finalPrice: { type: Number },
  resultPercent: { type: Number },
  auditDate: { type: Date },

  timestamp: { type: Date, default: Date.now }
});

// TTL Index: Mantém histórico por 30 dias
QuantSignalSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

const QuantSignal = mongoose.models.QuantSignal || mongoose.model('QuantSignal', QuantSignalSchema);
export default QuantSignal;
