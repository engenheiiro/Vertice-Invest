
import mongoose from 'mongoose';

const DividendEventSchema = new mongoose.Schema({
  ticker: { type: String, required: true, uppercase: true },
  
  // Data que o acionista precisava ter o papel (Ex-Date)
  date: { type: Date, required: true }, 
  
  // Data do pagamento (pode ser nula se apenas anunciado)
  paymentDate: { type: Date },
  
  // Valor por ação
  amount: { type: Number, required: true },
  
  // Dividendo, JCP, etc.
  type: { type: String, default: 'DIVIDEND' }, 
  
  currency: { type: String, default: 'BRL' },
  
  createdAt: { type: Date, default: Date.now }
});

// Índice único: Ticker + Ex-date + Tipo (evita duplicar o mesmo provento).
// O VALOR não entra na chave de propósito: o mesmo pagamento vem de fontes
// diferentes com valor levemente distinto (ex.: 0.109829 vs 0.109744) e, com o
// valor na chave, ambos eram inseridos — dobrando a soma de proventos.
// Requer datas normalizadas à meia-noite UTC (ver financialService.syncDividends
// e o script clean:dividends, que migra o índice antigo {ticker,date,amount}).
DividendEventSchema.index({ ticker: 1, date: 1, type: 1 }, { unique: true });

const DividendEvent = mongoose.models.DividendEvent || mongoose.model('DividendEvent', DividendEventSchema);
export default DividendEvent;
