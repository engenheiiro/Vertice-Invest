import mongoose from 'mongoose';

const TransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: String, enum: ['ESSENTIAL', 'PRO', 'ELITE', 'BLACK'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'BRL' },
  status: { type: String, enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'], default: 'PENDING' },
  // Índice único (sparse): garante idempotência de webhook/sync — a mesma
  // notificação do Mercado Pago (entregas duplicadas são normais) não pode
  // criar duas Transactions nem creditar plano em dobro. `sparse` permite
  // múltiplos documentos sem gatewayId (ex.: registros legados/manuais).
  gatewayId: { type: String, unique: true, sparse: true }, // ID da transação no gateway
  method: { type: String, enum: ['CREDIT_CARD', 'PIX', 'CRYPTO'], default: 'CREDIT_CARD' },
  createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', TransactionSchema);

export default Transaction;