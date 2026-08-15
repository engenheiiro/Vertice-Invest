
import mongoose from 'mongoose';

/**
 * Série diária de Preço Unitário (PU) de um título do Tesouro Direto.
 *
 * Fonte: CSV oficial "Preços e Taxas dos Títulos Públicos" (Tesouro Transparente),
 * o MESMO arquivo que o macroDataService já baixa para extrair a taxa da NTN-B.
 *
 * Existe porque renda fixa era precificada SÓ por accrual (compõe a taxa
 * contratada dia a dia) — uma curva suave, de volatilidade zero por construção.
 * Para pós-fixado isso é fiel; para IPCA+/prefixado longo não é: um Tesouro IPCA+
 * 2045 tem vol real de ~21% a.a. e caiu 23,7% em 2 anos. Tratado como accrual, ele
 * subestima o risco da carteira e infla Sharpe/vol de quem o carrega.
 *
 * Coleção separada de `AssetHistory` de propósito: aquela é varrida pelo
 * timeSeriesWorker (staleness/refresh por provedor de cotação) e um ticker
 * sintético de título público entraria naquele laço sem ter provedor.
 */
const TreasuryPriceHistorySchema = new mongoose.Schema({
  // Chave canônica `FAMILIA|YYYY-MM-DD` (ver utils/treasuryTitle.js).
  titleKey: { type: String, required: true, unique: true },
  // SELIC | PRE | PRE_JS | IPCA | IPCA_JS | IGPM_JS | EDUCA | RENDA
  family: { type: String, required: true },
  maturity: { type: String, required: true }, // YYYY-MM-DD
  // "Tipo Titulo" cru do CSV — rastreabilidade da fonte.
  sourceLabel: { type: String },
  // Paga cupom semestral (NTN-B/NTN-F). Esses títulos NÃO são marcados: o PU cai
  // 3% (NTN-B) a 6% (NTN-F) no dia do cupom, e sem tratar o cupom como provento
  // essa queda entraria na série de risco como perda — vol falsa. Ficam no accrual
  // até existir evento de cupom.
  hasCoupon: { type: Boolean, default: false },
  lastUpdated: { type: Date, default: Date.now },

  // Ordenada por data ASC (o parser garante) — a busca de PU faz varredura
  // "última data <= alvo" contando com isso.
  history: [{
    date: { type: String, required: true }, // YYYY-MM-DD (Data Base do CSV)
    // PU de VENDA: o que o investidor RECEBE ao vender de volta ao Tesouro.
    // É o preço de marcação da posição.
    pu: { type: Number, required: true },
    // PU de COMPRA: o que o investidor PAGA. Usado só para ancorar o custo do
    // lote no denominador da razão de marcação (ver utils/fixedIncome.js).
    puBuy: { type: Number },
    // Taxa de venda a.a. (%) — diagnóstico e guarda de plausibilidade.
    rate: { type: Number },
    _id: false,
  }],
});

const TreasuryPriceHistory = mongoose.models.TreasuryPriceHistory
  || mongoose.model('TreasuryPriceHistory', TreasuryPriceHistorySchema);
export default TreasuryPriceHistory;
