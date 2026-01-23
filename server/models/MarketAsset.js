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
  isActive: { type: Boolean, default: true },
  lastPrice: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

MarketAssetSchema.index({ type: 1, isActive: 1 });

const MarketAsset = mongoose.models.MarketAsset || mongoose.model('MarketAsset', MarketAssetSchema);
export default MarketAsset;