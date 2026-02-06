
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
  // CPF: Armazenar apenas números (11 dígitos). Sparse permite que usuários antigos fiquem sem CPF temporariamente.
  cpf: { 
    type: String, 
    unique: true, 
    sparse: true,
    trim: true,
    minlength: 11,
    maxlength: 14 
  },
  password: { type: String, required: true },
  
  // --- Controle de Acesso (RBAC) ---
  role: { 
    type: String, 
    enum: ['USER', 'ADMIN'], 
    default: 'USER' 
  },

  // --- Sistema de Assinatura ---
  plan: { 
    type: String, 
    enum: ['GUEST', 'ESSENTIAL', 'PRO', 'BLACK'], 
    default: 'ESSENTIAL'
  },
  subscriptionStatus: {
    type: String,
    enum: ['ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIAL'],
    default: 'ACTIVE'
  },
  validUntil: { type: Date },
  
  // --- Integração Mercado Pago ---
  mpCustomerId: { type: String },      // ID do cliente no MP
  mpSubscriptionId: { type: String },  // ID da assinatura recorrente (preapproval_id)

  // Recuperação de Senha
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },

  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
