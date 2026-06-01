
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true,
    trim: true,
    // Regex baseado na especificação HTML5 (rejeita espaços, múltiplos @, TLD ausente
    // e domínios/labels malformados). A validação primária ocorre via Zod (authSchemas).
    match: [/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/, 'Formato de email inválido']
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
  
  // --- Onboarding ---
  hasSeenTutorial: { type: Boolean, default: false },

  // --- Integração Mercado Pago ---
  mpCustomerId: { type: String },      // ID do cliente no MP
  mpSubscriptionId: { type: String },  // ID da assinatura recorrente (preapproval_id)

  // Recuperação de Senha
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },

  // --- MFA / 2FA (TOTP) — I14. Opt-in; campos sensíveis não retornam por padrão. ---
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, select: false },          // segredo TOTP confirmado
  mfaPendingSecret: { type: String, select: false },   // durante o setup, antes de confirmar
  mfaBackupCodes: { type: [String], select: false, default: [] }, // códigos de recuperação (hash)

  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
