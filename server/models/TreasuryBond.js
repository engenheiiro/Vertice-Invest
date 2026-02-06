
import mongoose from 'mongoose';

const TreasuryBondSchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true }, // Ex: Tesouro IPCA+ 2035
  type: { type: String, enum: ['PREFIXADO', 'IPCA', 'SELIC', 'RENDAMAIS', 'EDUCA'], default: 'IPCA' },
  rate: { type: Number, required: true }, // Taxa anual (ex: 6.25)
  index: { type: String }, // Ex: IPCA, SELIC ou PRE
  minInvestment: { type: Number, default: 0 }, // Investimento Mínimo (ex: 30.00)
  unitPrice: { type: Number, default: 0 }, // Preço Unitário Cheio (ex: 1200.00)
  maturityDate: { type: String }, // Guardando como string "dd/mm/aaaa" para exibição direta
  updatedAt: { type: Date, default: Date.now }
});

const TreasuryBond = mongoose.models.TreasuryBond || mongoose.model('TreasuryBond', TreasuryBondSchema);
export default TreasuryBond;
