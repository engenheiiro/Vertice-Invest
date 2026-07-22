import mongoose from 'mongoose';

const BatchIssueSchema = new mongoose.Schema({
  assetClass: { type: String, required: true },
  code: { type: String, default: 'UNKNOWN' },
  message: { type: String, required: true },
}, { _id: false });

const ResearchBatchSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true, index: true },
  strategy: { type: String, required: true, default: 'BUY_HOLD' },
  status: {
    type: String,
    enum: ['RUNNING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'PARTIAL', 'FAILED'],
    default: 'RUNNING',
    index: true,
  },
  expectedClasses: [{ type: String }],
  completedClasses: [{ type: String }],
  failedClasses: [{ type: String }],
  warnings: [BatchIssueSchema],
  failures: [BatchIssueSchema],
  algorithmVersion: { type: String, default: 'unknown' },
  inputManifest: { type: mongoose.Schema.Types.Mixed, default: {} },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
}, { versionKey: false });

ResearchBatchSchema.index({ startedAt: -1 });

const ResearchBatch = mongoose.models.ResearchBatch
  || mongoose.model('ResearchBatch', ResearchBatchSchema);

export default ResearchBatch;
