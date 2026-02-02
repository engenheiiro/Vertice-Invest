
import mongoose from 'mongoose';

const EconomicIndexSchema = new mongoose.Schema({
  series: { type: String, required: true, enum: ['CDI', 'IPCA', 'SELIC', 'IGPM'] },
  date: { type: Date, required: true },
  value: { type: Number, required: true }, // Valor percentual ou fator diário
  accumulatedFactor: { type: Number }, // Fator acumulado para facilitar cálculos de range
  createdAt: { type: Date, default: Date.now }
});

// Índice único para garantir apenas um valor por dia por série
EconomicIndexSchema.index({ series: 1, date: 1 }, { unique: true });

const EconomicIndex = mongoose.models.EconomicIndex || mongoose.model('EconomicIndex', EconomicIndexSchema);
export default EconomicIndex;
