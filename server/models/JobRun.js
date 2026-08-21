import mongoose from 'mongoose';

/**
 * Uma linha por execução de job (cron ou sync manual).
 *
 * Existe para responder "esse cron ainda está rodando?" — pergunta que log em
 * arquivo não responde, porque a ausência de linha é indistinguível de log
 * rotacionado. A sentinela de saúde lê a última execução de cada jobId e compara
 * com o teto de silêncio do `jobCatalog`.
 *
 * TTL de 30 dias: histórico serve para ver padrão de falha, não para auditoria
 * permanente.
 */
const JobRunSchema = new mongoose.Schema({
    // O índice composto { jobId, startedAt } abaixo já cobre busca por jobId.
    jobId: { type: String, required: true },
    label: { type: String, default: '' },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
    status: {
        type: String,
        enum: ['RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED'],
        default: 'RUNNING',
        index: true,
    },
    error: { type: String, default: null },
    // Quem escreveu esta linha ("host#pid"). Dois schedulers no mesmo banco (a
    // máquina de dev com .env de produção, um deploy sobrepondo o anterior) abrem
    // execuções indistinguíveis sem isto — provar que dois JobRun simultâneos
    // vinham de máquinas diferentes deu trabalho justamente por faltar o campo.
    instance: { type: String, default: null },
    // Payload livre por job (contadores, ids) — só para leitura humana no painel.
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
});

// Busca quente da sentinela: última execução por job.
JobRunSchema.index({ jobId: 1, startedAt: -1 });
// Retenção automática.
JobRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

const JobRun = mongoose.models.JobRun || mongoose.model('JobRun', JobRunSchema);
export default JobRun;
