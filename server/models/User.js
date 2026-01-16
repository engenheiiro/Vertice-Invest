import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Formato de email inválido']
  },
  password: { type: String, required: true },
  
  // --- Sistema de Assinatura (RBAC) ---
  plan: { 
    type: String, 
    enum: ['GUEST', 'ESSENTIAL', 'PRO', 'BLACK'], 
    default: 'ESSENTIAL' // Alterado conforme solicitado
  },
  subscriptionStatus: {
    type: String,
    enum: ['ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIAL'],
    default: 'ACTIVE' // Alterado conforme solicitado
  },
  validUntil: { type: Date }, // Data de expiração da assinatura
  
  // Recuperação de Senha
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },

  createdAt: { type: Date, default: Date.now }
});

// Prevenção de recompilação do modelo em ambiente de desenvolvimento (Hot Reload)
const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;