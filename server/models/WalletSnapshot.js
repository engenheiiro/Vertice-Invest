
import mongoose from 'mongoose';

const WalletSnapshotSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Carteira deste snapshot (Fase 2 — múltiplas carteiras).
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
  date: { type: Date, required: true }, // Data do snapshot (geralmente final do dia)
  
  totalEquity: { type: Number, required: true }, // Patrimônio Total
  totalInvested: { type: Number, required: true }, // Total Aportado
  totalDividends: { type: Number, default: 0 }, // Proventos Acumulados
  
  profit: { type: Number, default: 0 },
  profitPercent: { type: Number, default: 0 },
  
  // CORE V3: Sistema de Cotas
  // Permite calcular rentabilidade TWRR real, imune a aportes/resgates
  quotaPrice: { type: Number, default: 100 }, 

  // Opcional: Breakdown por classe para gráficos de alocação histórica
  allocation: {
    stock: Number,
    fii: Number,
    stockUs: Number,
    crypto: Number,
    fixed: Number,
    cash: Number
  },

  createdAt: { type: Date, default: Date.now }
});

// Índice composto para buscar histórico de UMA CARTEIRA ordenado por data.
WalletSnapshotSchema.index({ wallet: 1, date: 1 });
WalletSnapshotSchema.index({ user: 1, date: 1 }); // agregações "todas as carteiras do usuário"

const WalletSnapshot = mongoose.models.WalletSnapshot || mongoose.model('WalletSnapshot', WalletSnapshotSchema);
export default WalletSnapshot;
