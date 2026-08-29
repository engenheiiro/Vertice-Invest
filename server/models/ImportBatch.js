
import mongoose from 'mongoose';

/**
 * Um lote de importação de carteira (Investidor10 / extrato B3 / planilha).
 *
 * Existe por duas razões, e só por elas:
 *   1. **Desfazer.** O usuário acabou de despejar 200 lançamentos de uma vez; ele
 *      precisa de um botão que reverta isso inteiro sem caçar transação por
 *      transação. `AssetTransaction.importBatchId` aponta para cá.
 *   2. **Rastro.** Quando um número não bater, saber de qual fonte e de qual dia
 *      vieram aqueles lançamentos é a diferença entre diagnosticar e adivinhar.
 *
 * Não guarda as linhas em si — a verdade dos lançamentos é o `AssetTransaction`.
 * Este documento é o cabeçalho do lote, e nada mais.
 */
const ImportBatchSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },

  source: {
    type: String,
    enum: ['B3_MOVIMENTACAO', 'B3_NEGOCIACAO', 'INVESTIDOR10', 'SHEET'],
    required: true,
  },

  // Quantos lançamentos o lote criou de fato (após dedup e descarte na revisão).
  rowCount: { type: Number, required: true, default: 0 },
  // Tickers tocados — permite reverter/recalcular sem varrer a coleção inteira.
  tickers: { type: [String], default: [] },

  // Preenchido quando o lote é revertido; o documento fica como registro histórico
  // em vez de sumir (suporte precisa saber que existiu e que foi desfeito).
  undoneAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
});

ImportBatchSchema.index({ wallet: 1, createdAt: -1 });

const ImportBatch = mongoose.models.ImportBatch || mongoose.model('ImportBatch', ImportBatchSchema);
export default ImportBatch;
