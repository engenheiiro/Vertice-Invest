
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

// Índice único: Ticker + Data + Valor (evita duplicar o mesmo evento)
DividendEventSchema.index({ ticker: 1, date: 1, amount: 1 }, { unique: true });

const DividendEvent = mongoose.models.DividendEvent || mongoose.model('DividendEvent', DividendEventSchema);
export default DividendEvent;
