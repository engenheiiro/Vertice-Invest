import mongoose from 'mongoose';

/**
 * Fotografia da saúde dos dados num instante.
 *
 * Guardar histórico (e não só o último estado) é o que permite ver a degradação
 * CHEGANDO: cobertura de ROE caindo 3 p.p. por dia ainda passa em todo limiar,
 * mas a série mostra a queda antes do alarme disparar.
 *
 * TTL de 90 dias.
 */
const CheckSchema = new mongoose.Schema({
    id: String,
    label: String,
    category: String,
    status: { type: String, enum: ['OK', 'WARN', 'CRITICAL'] },
    value: { type: Number, default: null },
    detail: String,
    hint: String,
}, { _id: false });

const DataHealthReportSchema = new mongoose.Schema({
    // `runAt` tem índice explícito descendente abaixo (toda leitura é "o mais recente").
    runAt: { type: Date, required: true },
    status: { type: String, enum: ['OK', 'WARN', 'CRITICAL'], required: true, index: true },
    summary: {
        ok: { type: Number, default: 0 },
        warn: { type: Number, default: 0 },
        critical: { type: Number, default: 0 },
    },
    checks: { type: [CheckSchema], default: [] },
    // Quem disparou: 'CRON' | 'SYNC' | 'MANUAL'
    trigger: { type: String, default: 'CRON' },
    durationMs: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
});

DataHealthReportSchema.index({ runAt: -1 });
DataHealthReportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

const DataHealthReport = mongoose.models.DataHealthReport
    || mongoose.model('DataHealthReport', DataHealthReportSchema);
export default DataHealthReport;
