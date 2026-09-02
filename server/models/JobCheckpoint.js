import mongoose from 'mongoose';

/**
 * Checkpoint por item de jobs longos. No snapshot, itemKey é a carteira e runKey
 * é o dia civil brasileiro. Se o processo cair, a próxima execução retoma apenas
 * as carteiras que ainda não chegaram a SUCCESS.
 */
const JobCheckpointSchema = new mongoose.Schema({
    jobId: { type: String, required: true },
    runKey: { type: String, required: true },
    itemKey: { type: String, required: true },
    status: { type: String, enum: ['SUCCESS', 'FAILED'], required: true },
    result: { type: String, default: null },
    error: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

JobCheckpointSchema.index({ jobId: 1, runKey: 1, itemKey: 1 }, { unique: true });
JobCheckpointSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });

const JobCheckpoint = mongoose.models.JobCheckpoint || mongoose.model('JobCheckpoint', JobCheckpointSchema);
export default JobCheckpoint;
