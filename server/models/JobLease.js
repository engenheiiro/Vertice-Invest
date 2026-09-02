import mongoose from 'mongoose';

/**
 * Lease distribuído dos jobs recorrentes.
 *
 * Uma linha por jobId permite que várias instâncias compartilhem o mesmo Mongo
 * sem executar o mesmo trabalho simultaneamente. O token protege a liberação:
 * uma instância antiga nunca remove o lease renovado por outra.
 */
const JobLeaseSchema = new mongoose.Schema({
    jobId: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    token: { type: String, required: true },
    acquiredAt: { type: Date, required: true },
    heartbeatAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
}, { versionKey: false });

JobLeaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const JobLease = mongoose.models.JobLease || mongoose.model('JobLease', JobLeaseSchema);
export default JobLease;
