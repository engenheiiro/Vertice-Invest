
import mongoose from 'mongoose';
import { isValidDayKey, snapshotInstantForDay } from '../utils/walletSnapshot.js';

const WalletSnapshotSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Carteira deste snapshot (Fase 2 — múltiplas carteiras).
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
  date: {
    type: Date,
    required: true,
    validate: {
      validator(value) {
        const update = typeof this.getUpdate === 'function' ? this.getUpdate() : null;
        const dayKey = this.dayKey || update?.$set?.dayKey || update?.dayKey;
        if (!dayKey) return true;
        return isValidDayKey(dayKey)
          && new Date(value).getTime() === snapshotInstantForDay(dayKey).getTime();
      },
      message: 'date deve representar 23:59 BRT do dayKey',
    },
  }, // Data do snapshot (fechamento do dia em Brasília)
  // Identidade civil do snapshot no fuso de Brasília. Evita que instantes de
  // rebuild (12:00Z) e do cron (23:59 BRT) representem o mesmo dia duas vezes.
  dayKey: {
    type: String,
    default: null,
    validate: {
      validator: (value) => value === null || isValidDayKey(value),
      message: 'dayKey deve estar no formato YYYY-MM-DD e ser uma data válida',
    },
  },
  source: { type: String, enum: ['DAILY', 'REBUILD', 'BACKFILL', 'LEGACY'], default: 'LEGACY' },
  calculationVersion: { type: Number, default: 4 },
  // Momento em que a carteira foi efetivamente calculada. O live usa este
  // high-water mark para capturar lançamentos retroativos criados depois.
  calculatedAt: { type: Date, default: Date.now },
  
  totalEquity: { type: Number, required: true, min: 0 }, // Patrimônio Total
  totalInvested: { type: Number, required: true, min: 0 }, // Total Aportado
  totalDividends: { type: Number, default: 0 }, // Proventos Acumulados
  
  profit: { type: Number, default: 0 },
  profitPercent: { type: Number, default: 0 },
  
  // CORE V3: Sistema de Cotas
  // Permite calcular rentabilidade TWRR real, imune a aportes/resgates
  quotaPrice: { type: Number, default: 100, min: Number.EPSILON },

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

// Índice composto para buscar histórico de UMA CARTEIRA em qualquer direção.
// O Mongo percorre o mesmo B-tree ao contrário para `{ date: -1 }`.
WalletSnapshotSchema.index({ wallet: 1, date: 1 });
WalletSnapshotSchema.index(
  { wallet: 1, dayKey: 1 },
  { unique: true, partialFilterExpression: { dayKey: { $type: 'string' } } },
);
WalletSnapshotSchema.index({ user: 1, date: 1 }); // agregações "todas as carteiras do usuário"

const WalletSnapshot = mongoose.models.WalletSnapshot || mongoose.model('WalletSnapshot', WalletSnapshotSchema);
export default WalletSnapshot;
