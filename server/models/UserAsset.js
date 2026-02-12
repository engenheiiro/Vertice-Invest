
import mongoose from 'mongoose';

const UserAssetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ticker: { type: String, required: true, uppercase: true },
  type: { type: String, required: true },
  quantity: { type: Number, required: true, default: 0 },
  totalCost: { type: Number, required: true, default: 0 },
  
  // Lucro Realizado (Base: Preço Médio Ponderado - Padrão RFB Brasil)
  realizedProfit: { type: Number, default: 0 }, 
  
  // Lucro Realizado (Base: FIFO - First-In, First-Out - Padrão Internacional/Gerencial)
  fifoRealizedProfit: { type: Number, default: 0 },

  // --- NOVO: Lotes Fiscais Ativos (Para Renda Fixa Multi-Aporte e IR Futuro) ---
  taxLots: [{
    date: { type: Date, required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true }, // Preço unitário na compra
    _id: false // Não precisa de ID próprio
  }],

  currency: { type: String, default: 'BRL' },
  
  // Campos para Renda Fixa (Mantidos para Fallback)
  startDate: { type: Date }, 
  fixedIncomeRate: { type: Number, default: 0 }, // Taxa anual contratada
  
  // --- Feature: Tags Personalizadas ---
  tags: { type: [String], default: [] }, // Ex: ["Aposentadoria", "Viagem", "Risco"]

  updatedAt: { type: Date, default: Date.now }
});

UserAssetSchema.index({ user: 1, ticker: 1 }, { unique: true });

const UserAsset = mongoose.models.UserAsset || mongoose.model('UserAsset', UserAssetSchema);
export default UserAsset;
