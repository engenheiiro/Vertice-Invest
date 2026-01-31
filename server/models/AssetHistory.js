
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

// A definição `unique: true` no schema acima já cria o índice automaticamente.
// Removemos a linha AssetHistorySchema.index({ ticker: 1 }) para evitar o aviso de duplicidade.

const AssetHistory = mongoose.models.AssetHistory || mongoose.model('AssetHistory', AssetHistorySchema);
export default AssetHistory;
