
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
  // CPF cifrado em repouso (AES-256-GCM via utils/encryption — Art. 6 VII / 46 LGPD).
  // O valor armazenado é o ciphertext "iv:tag:data", NÃO os dígitos em claro.
  // A unicidade é garantida pelo blind index `cpfHash` (não por este campo).
  cpf: {
    type: String,
    trim: true,
  },
  // Blind index do CPF: HMAC-SHA256 determinístico (utils/encryption.blindIndex).
  // Permite checar unicidade/buscar sem expor o CPF. select:false → não retorna por padrão.
  cpfHash: {
    type: String,
    unique: true,
    sparse: true,
    select: false,
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
    enum: ['GUEST', 'ESSENTIAL', 'PRO', 'ELITE', 'BLACK'],
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

  // --- Carteira Ideal (alocação-alvo definida pelo usuário) ---
  // Percentuais por classe de ativo (somam ~100% nos investimentos) + reserva em valor fixo (R$).
  targetAllocation: {
    type: new mongoose.Schema({
      STOCK: { type: Number, default: 0 },
      FII: { type: Number, default: 0 },
      STOCK_US: { type: Number, default: 0 },
      CRYPTO: { type: Number, default: 0 },
      FIXED_INCOME: { type: Number, default: 0 },
    }, { _id: false }),
    default: () => ({ STOCK: 40, FII: 30, STOCK_US: 20, CRYPTO: 10, FIXED_INCOME: 0 }),
  },
  targetReserve: { type: Number, default: 10000 },

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

  createdAt: { type: Date, default: Date.now },

  // --- Desativação de Conta (soft-delete) ---
  isActive: { type: Boolean, default: true },
  deactivatedAt: { type: Date },

  // --- Consentimento LGPD (Art. 7, 8) ---
  termsAcceptedAt: { type: Date },
  privacyAcceptedAt: { type: Date },
  consentVersion: { type: String },
  marketingOptIn: { type: Boolean, default: false },

  // --- Perfil Adicional ---
  phone: { type: String, trim: true },
  occupation: { type: String, trim: true },
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
