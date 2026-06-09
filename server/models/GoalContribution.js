
import mongoose from 'mongoose';

/**
 * Aporte MANUAL avulso de uma meta — dinheiro guardado fora da carteira
 * (poupança, conta, etc.). Aportes que viram ativos da carteira NÃO entram
 * aqui: são derivados de AssetTransaction quando a meta espelha a carteira.
 * Ao criar/remover, o controller ajusta InvestmentGoal.manualBalance.
 */
const GoalContributionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  goal: { type: mongoose.Schema.Types.ObjectId, ref: 'InvestmentGoal', required: true },

  amount: { type: Number, required: true }, // pode ser negativo (resgate)
  date: { type: Date, required: true, default: Date.now },
  note: { type: String, trim: true },

  createdAt: { type: Date, default: Date.now },
});

GoalContributionSchema.index({ user: 1, goal: 1, date: -1 });

const GoalContribution = mongoose.models.GoalContribution || mongoose.model('GoalContribution', GoalContributionSchema);
export default GoalContribution;
