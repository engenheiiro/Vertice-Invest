import mongoose from 'mongoose';

const UserAssetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ticker: { type: String, required: true, uppercase: true },
  type: { type: String, required: true },
  quantity: { type: Number, required: true, default: 0 },
  totalCost: { type: Number, required: true, default: 0 },
  currency: { type: String, default: 'BRL' },
  updatedAt: { type: Date, default: Date.now }
});

UserAssetSchema.index({ user: 1, ticker: 1 }, { unique: true });

const UserAsset = mongoose.models.UserAsset || mongoose.model('UserAsset', UserAssetSchema);
export default UserAsset;