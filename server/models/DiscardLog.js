
import mongoose from 'mongoose';

const DiscardLogSchema = new mongoose.Schema({
  runId: { type: String, required: true }, // ID único da execução (timestamp ou uuid)
  ticker: { type: String, required: true },
  reason: { type: String, required: true }, // Motivo: "Liquidez Baixa", "P/L Alto", etc.
  details: { type: String }, // Valor que causou o descarte (ex: "Liquidez: 5000")
  assetType: { type: String },
  createdAt: { type: Date, default: Date.now, expires: '7d' } // Auto-limpeza após 7 dias
});

const DiscardLog = mongoose.models.DiscardLog || mongoose.model('DiscardLog', DiscardLogSchema);
export default DiscardLog;
