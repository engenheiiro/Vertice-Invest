import mongoose from 'mongoose';

const WalletSnapshotBackupSchema = new mongoose.Schema({
  runId: { type: String, required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
  wallet: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  originalId: { type: mongoose.Schema.Types.ObjectId, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  backedUpAt: { type: Date, default: Date.now },
});

WalletSnapshotBackupSchema.index({ runId: 1, originalId: 1 }, { unique: true });

const WalletSnapshotBackup = mongoose.models.WalletSnapshotBackup
  || mongoose.model('WalletSnapshotBackup', WalletSnapshotBackupSchema);

export default WalletSnapshotBackup;

