
import mongoose from 'mongoose';

const UserAssetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ticker: { type: String, required: true, uppercase: true },
  // Nome amigável (ex.: nome do "cofrinho" de uma Reserva/Caixa, ou nome do título
  // de Renda Fixa). Para ativos de mercado o nome vem da cotação ao vivo.
  name: { type: String },
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
  fixedIncomeRate: { type: Number, default: 0 }, // Taxa anual contratada (prefixado: taxa cheia; legado: %CDI quando >50)
  // Pós-fixados/indexados: o rendimento é índice vivo + spread (não a taxa cheia).
  // Ex.: Tesouro Selic "SELIC + 0,08%" → fixedIncomeIndex='SELIC', fixedIncomeSpread=0.0843.
  fixedIncomeIndex: { type: String, enum: ['SELIC', 'CDI', 'IPCA', 'PRE', null], default: null },
  fixedIncomeSpread: { type: Number, default: 0 }, // Spread a.a. sobre o índice (%)

  // --- Sub-tipo de ativo do Exterior (ramificação STOCK_US) ---
  // STOCK | ETF | REIT | DOLLAR. null = não classificado (auto-heurística decide).
  // usSubTypeManual=true: usuário definiu manualmente; a heurística NÃO sobrescreve.
  usSubType: { type: String, enum: ['STOCK', 'ETF', 'REIT', 'DOLLAR', 'GOLD', null], default: null },
  usSubTypeManual: { type: Boolean, default: false },

  // --- Feature: Tags Personalizadas ---
  tags: { type: [String], default: [] }, // Ex: ["Aposentadoria", "Viagem", "Risco"]

  updatedAt: { type: Date, default: Date.now }
});

UserAssetSchema.index({ user: 1, ticker: 1 }, { unique: true });

const UserAsset = mongoose.models.UserAsset || mongoose.model('UserAsset', UserAssetSchema);
export default UserAsset;
