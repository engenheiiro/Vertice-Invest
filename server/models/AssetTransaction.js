
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

  // --- Importação de carteira (Investidor10 / extrato B3 / planilha) ---
  // Lote que criou este lançamento. Sustenta o "desfazer importação": um único
  // deleteMany por batchId reverte tudo.
  //
  // COM `default: null`, ao contrário de `currency`/`fxRate` acima: aqui ausente
  // e null querem dizer exatamente a mesma coisa ("não veio de importação"), então
  // o default aplicado na hidratação de um documento legado não apaga informação
  // nenhuma — não há fallback a preservar.
  importBatchId: { type: String, default: null },
  importSource: {
    type: String,
    enum: ['B3_MOVIMENTACAO', 'B3_NEGOCIACAO', 'INVESTIDOR10', 'SHEET', null],
    default: null,
  },

  createdAt: { type: Date, default: Date.now }
});

// Reversão de um lote inteiro (deleteMany por batch) e listagem de importações.
AssetTransactionSchema.index({ wallet: 1, importBatchId: 1 });

// Índices que cobrem filtro + ordenação das duas listagens quentes. `createdAt`
// desempata lançamentos do mesmo dia; sem ele o Mongo fazia um estágio SORT em
// memória mesmo já tendo `{ wallet, ticker, date }`.
AssetTransactionSchema.index({ wallet: 1, ticker: 1, date: -1, createdAt: -1 });
AssetTransactionSchema.index({ wallet: 1, date: -1, createdAt: -1 });
AssetTransactionSchema.index({ user: 1 }); // consultas "todas as carteiras do usuário"

const AssetTransaction = mongoose.models.AssetTransaction || mongoose.model('AssetTransaction', AssetTransactionSchema);
export default AssetTransaction;
