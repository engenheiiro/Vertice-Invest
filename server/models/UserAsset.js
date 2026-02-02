
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

  currency: { type: String, default: 'BRL' },
  
  // Campos para Renda Fixa
  startDate: { type: Date }, // Data do aporte inicial para cálculo de juros
  fixedIncomeRate: { type: Number, default: 0 }, // Taxa anual contratada
  
  updatedAt: { type: Date, default: Date.now }
});

UserAssetSchema.index({ user: 1, ticker: 1 }, { unique: true });

const UserAsset = mongoose.models.UserAsset || mongoose.model('UserAsset', UserAssetSchema);
export default UserAsset;
