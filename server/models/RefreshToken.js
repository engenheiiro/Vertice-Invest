import mongoose from 'mongoose';

const RefreshTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // TTL automático: MongoDB remove o documento quando expiryDate é atingido (Art. 15-16 LGPD)
  expiryDate: { type: Date, required: true },
});

// Índice TTL — expira o documento assim que expiryDate for passado
RefreshTokenSchema.index({ expiryDate: 1 }, { expireAfterSeconds: 0 });

// Verifica se o token expirou (usado em runtime antes do TTL agir)
RefreshTokenSchema.statics.verifyExpiration = (token) => {
  return token.expiryDate.getTime() < new Date().getTime();
};

const RefreshToken = mongoose.model('RefreshToken', RefreshTokenSchema);

export default RefreshToken;