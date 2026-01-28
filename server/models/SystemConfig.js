
import mongoose from 'mongoose';

const SystemConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'MACRO_INDICATORS' },
  selic: { type: Number, required: true, default: 11.25 },
  ipca: { type: Number, required: true, default: 4.50 },
  cdi: { type: Number, required: true, default: 11.15 },
  riskFree: { type: Number, required: true, default: 11.25 },
  ntnbLong: { type: Number, required: true, default: 6.30 },
  dollar: { type: Number, default: 5.75 },
  lastUpdated: { type: Date, default: Date.now }
});

const SystemConfig = mongoose.models.SystemConfig || mongoose.model('SystemConfig', SystemConfigSchema);
export default SystemConfig;
