
import mongoose from 'mongoose';

const AssetHistorySchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true, uppercase: true },
  lastUpdated: { type: Date, default: Date.now },
  // Armazenamos um array de objetos simplificados para economizar espaço e facilitar busca
  history: [{
    date: { type: String, required: true }, // Formato YYYY-MM-DD
    close: Number,
    adjClose: Number
  }]
});

// Índice para busca rápida por Ticker
AssetHistorySchema.index({ ticker: 1 });

const AssetHistory = mongoose.models.AssetHistory || mongoose.model('AssetHistory', AssetHistorySchema);
export default AssetHistory;
