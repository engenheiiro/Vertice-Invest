
import mongoose from 'mongoose';

const AssetTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ticker: { type: String, required: true, uppercase: true },
  
  // Referência opcional ao ativo pai (para facilitar queries, mas o ticker é a chave principal de agrupamento)
  assetId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAsset' }, 

  type: { type: String, enum: ['BUY', 'SELL'], required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true }, // Preço unitário
  totalValue: { type: Number, required: true }, // Qty * Price
  date: { type: Date, required: true, default: Date.now },
  
  notes: { type: String },
  
  createdAt: { type: Date, default: Date.now }
});

// Índices para performance na busca de histórico
AssetTransactionSchema.index({ user: 1, ticker: 1, date: 1 });

const AssetTransaction = mongoose.models.AssetTransaction || mongoose.model('AssetTransaction', AssetTransactionSchema);
export default AssetTransaction;
