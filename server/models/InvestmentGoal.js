
import mongoose from 'mongoose';

/**
 * Meta patrimonial do usuário (planejador de metas / goal-based investing).
 *
 * Modo HÍBRIDO: o valor atual da meta = (mirrorWallet ? patrimônio real da
 * carteira : 0) + manualBalance (dinheiro acumulado fora da carteira, lançado
 * via GoalContribution). A projeção de meses restantes usa taxa fixa anual
 * (expectedAnnualRate) e a matemática de server/utils/goalMath.js.
 */
const InvestmentGoalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  name: { type: String, required: true, trim: true },
  icon: { type: String, default: 'target' }, // chave do mapa de ícones no front
  color: { type: String, default: 'emerald' }, // accent do card

  targetAmount: { type: Number, required: true }, // alvo (R$)
  monthlyTarget: { type: Number, required: true, default: 0 }, // aporte planejado/mês
  expectedAnnualRate: { type: Number, required: true, default: 10 }, // % a.a. (taxa fixa)

  startDate: { type: Date, default: Date.now },
  targetDate: { type: Date }, // opcional; se ausente, a data é derivada da projeção

  // Valor da meta na criação — baseline da curva "Plano" (real vs. planejado).
  startValue: { type: Number, default: 0 },

  // Espelha o patrimônio total da carteira no valor atual da meta.
  mirrorWallet: { type: Boolean, default: true },
  // Dinheiro acumulado FORA da carteira (somatório dos aportes manuais).
  manualBalance: { type: Number, default: 0 },

  status: { type: String, enum: ['ACTIVE', 'ACHIEVED', 'ARCHIVED'], default: 'ACTIVE' },
  achievedAt: { type: Date }, // quando cruzou o alvo (vira a "Data real")
  // Maior marco (25/50/75/100) já comemorado — evita repetir a celebração.
  lastCelebratedMilestone: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

InvestmentGoalSchema.index({ user: 1, status: 1 });

const InvestmentGoal = mongoose.models.InvestmentGoal || mongoose.model('InvestmentGoal', InvestmentGoalSchema);
export default InvestmentGoal;
