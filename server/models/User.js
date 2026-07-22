
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

  // Incrementada quando uma sessão deve deixar de ser válida imediatamente
  // (por exemplo, troca de senha). O valor entra no access token e é conferido
  // pelo middleware, sem depender da expiração natural do JWT.
  sessionVersion: { type: Number, default: 0 },
  
  // --- Onboarding ---
  hasSeenTutorial: { type: Boolean, default: false },

  // Carteira ativa no momento (Fase 2 — múltiplas carteiras). O middleware
  // resolveWallet cai para a primeira carteira do usuário quando ausente/inválido.
  // walletName e os campos target* (alocação-alvo, reserva, sub-metas, meta de
  // renda) migraram para o modelo Wallet — cada carteira tem os seus próprios,
  // em vez de um único conjunto por conta (ver server/models/Wallet.js).
  activeWalletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet' },

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

  // Foto de perfil (3.17). Guarda uma data-URL pequena (imagem já
  // redimensionada/comprimida no cliente p/ 256×256). String vazia/ausente →
  // a UI cai no fallback de iniciais. Validação de mime/tamanho no controller.
  avatar: { type: String },

  // Principal corretora (3.21a). Texto livre — o frontend oferece um select
  // com as corretoras conhecidas + "Outra"; aqui guardamos o rótulo escolhido.
  brokerage: { type: String, trim: true },

  // Endereço (3.21b). Preenchido via ViaCEP no cliente. PII de baixo grau,
  // mantido em claro (mesma postura de phone/occupation).
  cep: { type: String, trim: true },
  street: { type: String, trim: true },        // logradouro
  neighborhood: { type: String, trim: true },  // bairro
  city: { type: String, trim: true },
  state: { type: String, trim: true },         // UF

  // Dados sensíveis (3.21c/d) — cifrados em repouso (AES-256-GCM via
  // utils/encryption), mesma postura do CPF (Art. 6 VII / 46 LGPD). O valor
  // armazenado é o ciphertext "keyId:iv:tag:data", NÃO o valor em claro.
  // birthDate guarda a data ISO (YYYY-MM-DD) cifrada; salary, o número cifrado.
  birthDate: { type: String },
  salary: { type: String },

  // Preset de gradiente do banner de perfil escolhido pelo usuário (3.20).
  // Guarda só a REFERÊNCIA do preset (não a imagem). Vazio → usa o gradiente
  // padrão do plano como fallback. Allowlist validada no updateProfile.
  bannerColor: {
    type: String,
    enum: ['ocean', 'emerald', 'royal', 'sunset', 'gold', 'graphite'],
  },
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
