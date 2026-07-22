import mongoose from 'mongoose';

const PublishedResearchPointerSchema = new mongoose.Schema({
  assetClass: { type: String, required: true },
  strategy: { type: String, required: true, default: 'BUY_HOLD' },
  section: {
    type: String,
    enum: ['RANKING', 'MORNING_CALL', 'REPORT', 'EXPLAINABLE_AI'],
    required: true,
  },
  analysis: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketAnalysis', required: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ResearchBatch', default: null },
  activatedAt: { type: Date, default: Date.now },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { versionKey: false });

PublishedResearchPointerSchema.index(
  { assetClass: 1, strategy: 1, section: 1 },
  { unique: true },
);

const PublishedResearchPointer = mongoose.models.PublishedResearchPointer
  || mongoose.model('PublishedResearchPointer', PublishedResearchPointerSchema);

export default PublishedResearchPointer;
