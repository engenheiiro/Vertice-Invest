
import mongoose from 'mongoose';

const UsageLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  feature: { type: String, required: true }, // ex: 'smart_contribution', 'report'
  monthKey: { type: String, required: true }, // ex: '2023-10'
  count: { type: Number, default: 0 },
  lastUsed: { type: Date, default: Date.now }
});

// Índice único composto para busca rápida
UsageLogSchema.index({ user: 1, feature: 1, monthKey: 1 }, { unique: true });

const UsageLog = mongoose.models.UsageLog || mongoose.model('UsageLog', UsageLogSchema);
export default UsageLog;
