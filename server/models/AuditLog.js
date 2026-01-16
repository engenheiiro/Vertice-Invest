import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true }, // LOGIN_SUCCESS, LOGIN_FAIL, LOGOUT, REGISTER
  email: { type: String }, // Útil para logs de falha de login onde não temos ID
  ipAddress: { type: String },
  userAgent: { type: String },
  details: { type: String },
  timestamp: { type: Date, default: Date.now }
});

const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

export default AuditLog;