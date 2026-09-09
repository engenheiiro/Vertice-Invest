
import mongoose from 'mongoose';

const DividendEventSchema = new mongoose.Schema({
  ticker: { type: String, required: true, uppercase: true },
  
  // Data que o acionista precisava ter o papel (Ex-Date)
  date: { type: Date, required: true }, 
  
  // Data do pagamento — quando o dinheiro cai na conta.
  //
  // NULO é o estado honesto por padrão: nossa fonte de proventos (Yahoo) não
  // publica este campo, e quem preenche é `dividendPaymentDateService` a partir
  // do calendário da B3 (ou do Fundamentus, no backfill manual). Nulo faz
  // `resolvePaymentDate` cair na estimativa ex+15 e a tela marcar "Previsto".
  //
  // Só grave aqui data vinda de FONTE, nunca deduzida. Em 09/09/2026 havia 442
  // eventos com data preenchida — todos exatamente ex+16, incluindo 25/12 e
  // 01/01, dias em que a B3 não liquida. Era estimativa gravada como se fosse
  // anúncio, e como `resolvePaymentDate` trata qualquer valor não-nulo como
  // oficial, a tela exibia "Agendado" sobre uma data inventada. Foram removidos
  // por `scripts/cleanFabricatedPaymentDates.js`; `paymentDateSource` existe para
  // que a diferença entre dado e dedução nunca mais dependa de arqueologia.
  paymentDate: { type: Date },

  // Procedência da DATA DE PAGAMENTO (não do valor — esse é `source`).
  // Ausente com `paymentDate` presente = data de origem desconhecida, que é
  // exatamente o estado que o script de limpeza apaga.
  paymentDateSource: { type: String, enum: ['B3', 'FUNDAMENTUS'] },
  
  // Valor por ação
  amount: { type: Number, required: true },
  
  // Dividendo, JCP, etc.
  type: { type: String, default: 'DIVIDEND' },

  // Procedência do registro.
  //  PROVIDER — publicado pela fonte oficial (Yahoo). Autoritativo.
  //  DERIVED  — PROVISÓRIO, deduzido do gap do dia-ex enquanto a fonte não
  //             publica (ver utils/dividendGap.js). Colapsa no MESMO documento
  //             quando o oficial chega, pelo índice único {ticker,date,type}.
  // Documentos anteriores a set/2026 não têm o campo; ausência = PROVIDER.
  source: { type: String, enum: ['PROVIDER', 'DERIVED'], default: 'PROVIDER' },

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
