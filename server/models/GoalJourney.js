import mongoose from 'mongoose';

/**
 * Jornada de metas — a identidade de uma cadeia sequencial.
 *
 * A ordem dos marcos continua vindo de `InvestmentGoal.previousGoalId`; o que
 * mora aqui é só o NOME que o usuário deu ao conjunto. Antes disso a jornada era
 * implícita e o cabeçalho precisava derivar um rótulo da última meta — dois
 * caminhos com o mesmo alvo ficavam indistinguíveis, e no modo privacidade o
 * rótulo derivado do valor virava máscara em todas elas.
 *
 * Cadeia antiga (sem jornada) segue funcionando: a jornada é criada e vinculada
 * a todos os marcos no primeiro rename, sem migração.
 */
const GoalJourneySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Carteira dona da jornada — metas são por carteira (Fase 2).
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },

  name: { type: String, required: true, trim: true, maxlength: 60 },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

GoalJourneySchema.index({ user: 1, wallet: 1 });

const GoalJourney = mongoose.models.GoalJourney || mongoose.model('GoalJourney', GoalJourneySchema);
export default GoalJourney;
