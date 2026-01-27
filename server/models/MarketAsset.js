
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
  sector: { type: String, default: 'Geral' },
  
  // Dados Financeiros Persistidos
  lastPrice: { type: Number, default: 0 },
  netDebt: { type: Number, default: 0 }, // Dívida Líquida Persistida
  marketCap: { type: Number, default: 0 }, // Valor de Mercado Persistido
  
  // Dados Específicos FII (Cache Persistido)
  vacancy: { type: Number, default: 0 },
  p_vp: { type: Number, default: 0 },
  dy: { type: Number, default: 0 },
  
  isActive: { type: Boolean, default: true },
  lastAnalysisDate: { type: Date },
  updatedAt: { type: Date, default: Date.now }
});

// Removemos index: true do campo ticker e mantemos apenas aqui para evitar duplicidade
MarketAssetSchema.index({ type: 1, isActive: 1 });
MarketAssetSchema.index({ ticker: 1 });

const MarketAsset = mongoose.models.MarketAsset || mongoose.model('MarketAsset', MarketAssetSchema);
export default MarketAsset;
