import mongoose from 'mongoose';

/**
 * Erros do backend persistidos no próprio banco.
 *
 * Complementa (não substitui) o Winston e o Sentry: o arquivo de log é bom para
 * investigar um caso conhecido, mas ruim para "o que quebrou desde ontem?" numa
 * tela. Aqui o erro fica agrupado por fingerprint com contador, no formato que o
 * painel do Admin consome direto.
 *
 * `fingerprint` agrupa ocorrências do MESMO erro (origem + código + mensagem
 * normalizada), para que 400 repetições de uma falha virem uma linha com
 * `count: 400` em vez de 400 linhas.
 *
 * TTL de 14 dias sobre `lastSeenAt` — erro que parou de acontecer há duas semanas
 * já não é sinal.
 */
const ErrorLogSchema = new mongoose.Schema({
    fingerprint: { type: String, required: true, unique: true },
    // 'HTTP' (rota), 'JOB' (cron/sync), 'INGESTION' (fonte externa)
    origin: { type: String, enum: ['HTTP', 'JOB', 'INGESTION'], default: 'HTTP', index: true },
    // Rota, jobId ou nome da fonte.
    source: { type: String, default: '' },
    code: { type: String, default: '' },
    message: { type: String, default: '' },
    stack: { type: String, default: null },
    statusCode: { type: Number, default: null },
    count: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    // Sem `index: true` aqui: os índices explícitos abaixo (ordenação + TTL) já
    // cobrem o campo, e declarar nos dois lugares gera índice duplicado.
    lastSeenAt: { type: Date, default: Date.now },
    // Marcado pelo admin como "já tratei" — some do topo do painel sem apagar.
    resolvedAt: { type: Date, default: null },
});

// Um índice só: o do TTL. Índice de campo único é percorrido nas duas direções,
// então este também atende o `sort({ lastSeenAt: -1 })` do painel. Declarar um
// `{ lastSeenAt: -1 }` separado só custaria escrita a cada erro registrado.
ErrorLogSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });

const ErrorLog = mongoose.models.ErrorLog || mongoose.model('ErrorLog', ErrorLogSchema);
export default ErrorLog;
