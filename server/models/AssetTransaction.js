
import mongoose from 'mongoose';

const AssetTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Carteira dona deste lançamento (Fase 2 — múltiplas carteiras).
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
  ticker: { type: String, required: true, uppercase: true },
  
  // Referência opcional ao ativo pai (para facilitar queries, mas o ticker é a chave principal de agrupamento)
  assetId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAsset' }, 

  type: { type: String, enum: ['BUY', 'SELL'], required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true }, // Preço unitário
  totalValue: { type: Number, required: true }, // Qty * Price
  // Moeda NATIVA em que `price`/`totalValue` foram gravados (US$ para STOCK_US e
  // CRYPTO). Sem isso o extrato exibia uma compra de US$ 400 como "R$ 400,00" e
  // a soma não fechava com o Valor Aplicado da carteira, que é convertido.
  //
  // SEM `default` de propósito: o Mongoose aplica defaults ao hidratar documentos
  // que não têm o campo, então um default 'BRL' tornaria lançamentos legados
  // indistinguíveis dos genuinamente em real e mataria o fallback pela posição
  // (ver resolveTransactionCurrency em utils/assetCurrency.js). Ausente = legado.
  currency: { type: String, enum: ['BRL', 'USD'] },

  // Câmbio da moeda nativa → BRL NA DATA do lançamento (BRL sempre 1). Congela o
  // custo em reais: sem ele, reconverter o custo pelo dólar de hoje cancela o
  // câmbio contra o saldo e o resultado cambial some do extrato e da carteira.
  //
  // SEM `default` pelo mesmo motivo de `currency`: o Mongoose aplicaria o default
  // ao hidratar lançamentos legados, tornando-os indistinguíveis dos carimbados.
  // Ausente = legado; `utils/fxRate.js` reconstrói pelo histórico USD-BRL.
  fxRate: { type: Number },
  date: { type: Date, required: true, default: Date.now },
  
  notes: { type: String },
  
  createdAt: { type: Date, default: Date.now }
});

// Índices para performance na busca de histórico
AssetTransactionSchema.index({ wallet: 1, ticker: 1, date: 1 });
AssetTransactionSchema.index({ user: 1 }); // consultas "todas as carteiras do usuário"

const AssetTransaction = mongoose.models.AssetTransaction || mongoose.model('AssetTransaction', AssetTransactionSchema);
export default AssetTransaction;
