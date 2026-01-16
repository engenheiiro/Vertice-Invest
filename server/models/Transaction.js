import mongoose from 'mongoose';

const TransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: String, enum: ['ESSENTIAL', 'PRO', 'BLACK'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'BRL' },
  status: { type: String, enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'], default: 'PENDING' },
  gatewayId: { type: String }, // ID da transação no Stripe/Pagar.me (Simulado)
  method: { type: String, enum: ['CREDIT_CARD', 'PIX', 'CRYPTO'], default: 'CREDIT_CARD' },
  createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', TransactionSchema);

export default Transaction;