
import mongoose from 'mongoose';

const AssetHistorySchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true, uppercase: true },
  // lastUpdated = última vez que os CANDLES foram realmente re-buscados da fonte.
  // NÃO deve ser renovado por "touch" — esse era o bug que congelava as séries:
  // o worker renovava lastUpdated diariamente sem buscar dados, então o check de
  // staleness (baseado nele) nunca disparava e a série parava no tempo.
  lastUpdated: { type: Date, default: Date.now },
  // lastCheckedAt = última visita do worker (com ou sem re-busca) — só p/ monitoramento.
  lastCheckedAt: { type: Date, default: null },
  // Armazenamos um array de objetos simplificados para economizar espaço e facilitar busca
  history: [{
    date: { type: String, required: true }, // Formato YYYY-MM-DD
    close: Number,
    adjClose: Number,
    volume: Number // Volume negociado no dia — usado pelo filtro de volume dos sinais (7.3)
  }]
});

// A definição `unique: true` no schema acima já cria o índice automaticamente.
// Removemos a linha AssetHistorySchema.index({ ticker: 1 }) para evitar o aviso de duplicidade.

const AssetHistory = mongoose.models.AssetHistory || mongoose.model('AssetHistory', AssetHistorySchema);
export default AssetHistory;
