
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
  
  // --- Metadados de Análise ---
  sector: { type: String, default: 'Geral' }, 
  isIgnored: { type: Boolean, default: false }, 
  isBlacklisted: { type: Boolean, default: false }, 
  isTier1: { type: Boolean, default: false }, 
  
  // Dados Financeiros Persistidos (Cache)
  lastPrice: { type: Number, default: 0 },
  netDebt: { type: Number, default: 0 },
  marketCap: { type: Number, default: 0 },
  
  // Dados Específicos FII (Cache)
  vacancy: { type: Number, default: 0 },
  p_vp: { type: Number, default: 0 },
  dy: { type: Number, default: 0 },
  
  isActive: { type: Boolean, default: true },
  lastAnalysisDate: { type: Date },
  updatedAt: { type: Date, default: Date.now }
});

// Apenas índices compostos ou que não sejam 'unique' devem ser definidos aqui
// Removido ticker: 1 pois unique: true já cria o índice
MarketAssetSchema.index({ type: 1, isActive: 1 });

const MarketAsset = mongoose.models.MarketAsset || mongoose.model('MarketAsset', MarketAssetSchema);
export default MarketAsset;
