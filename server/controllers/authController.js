
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { runTransaction, txError } from '../utils/dbTransaction.js';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import AuditLog from '../models/AuditLog.js';
import UserAsset from '../models/UserAsset.js';
import AssetTransaction from '../models/AssetTransaction.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import UsageLog from '../models/UsageLog.js';
import InvestmentGoal from '../models/InvestmentGoal.js';
import GoalContribution from '../models/GoalContribution.js';
import QuizAttempt from '../models/QuizAttempt.js';
import UserProgress from '../models/UserProgress.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import { paymentService } from '../services/paymentService.js';
import { sendResetPasswordEmail } from '../services/emailService.js';
import logger from '../config/logger.js';
import { getPasswordError } from '../utils/passwordPolicy.js'; // (S6) política de senha
import { invalidateUser } from '../utils/userCache.js'; // (I6) bust de cache no update de perfil
import { verifyTotp, consumeBackupCode } from '../utils/mfa.js'; // (I14) MFA no login
import { encrypt, decrypt, blindIndex } from '../utils/encryption.js'; // (S) cripto em repouso: mfaSecret + CPF
import { issueCsrfToken, clearCsrfToken } from '../middleware/csrf.js'; // (1.4) CSRF double-submit
import { validateCpf } from '../utils/cpfUtils.js';

// Mascara e-mail para logs de auditoria — ex: j***@gmail.com
const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return '[no-email]';
  const [user, domain] = email.split('@');
  if (!domain) return '[masked]';
  return `${user.charAt(0)}***@${domain}`;
};

// Versão do consentimento — incrementar ao alterar Termos ou Política de Privacidade
const CONSENT_VERSION = '1.0';

// (3.17) Avatar: limites de validação do data-URL recebido. A imagem já chega
// redimensionada (256×256) e comprimida pelo cliente; estes tetos são a defesa
// do servidor contra payloads abusivos. ~300KB de base64 cobre folgadamente
// um JPEG/WebP 256×256, abaixo do limite de 1mb do express.json (app.js).
const AVATAR_MAX_LENGTH = 400_000; // chars da data-URL
const AVATAR_DATAURL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

// (3.21a) Corretoras conhecidas. O usuário pode escolher uma delas ou "Outra"
// (texto livre) — por isso o backend valida só comprimento, não a allowlist.
const KNOWN_BROKERAGES = [
  'XP Investimentos', 'BTG Pactual', 'Rico', 'Clear', 'Inter',
  'Nubank/NuInvest', 'Itaú/Íon', 'Toro', 'Genial', 'Ágora', 'Modalmais',
  'Guide', 'Órama', 'Santander Corretora', 'Caixa Corretora',
];

// Configurações
const ACCESS_TOKEN_EXPIRATION = '15m';
const REFRESH_TOKEN_EXPIRATION_DAYS = 7;

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET e JWT_REFRESH_SECRET devem estar definidos no ambiente.');
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// (F5) Rotação de refresh token com janela de graça para concorrência multi-aba.
// O cookie de refresh é COMPARTILHADO entre abas do mesmo domínio; duas abas podem
// apresentar o mesmo token simultaneamente antes de qualquer resposta rotacioná-lo.
// Sem graça, o "perdedor" da corrida receberia 401 e cairia no /login. Guardamos
// por poucos segundos o mapeamento hash-antigo → novo cookie: a aba retardatária
// recebe o MESMO novo token em vez de erro. Fora dessa janela, hash ausente = reuso.
const REFRESH_GRACE_MS = 15 * 1000;
const recentlyRotated = new Map(); // oldHash -> { newTokenString, userId, expires }

const rememberRotation = (oldHash, newTokenString, userId) => {
  recentlyRotated.set(oldHash, { newTokenString, userId, expires: Date.now() + REFRESH_GRACE_MS });
  // Expurgo oportunístico para não crescer indefinidamente.
  if (recentlyRotated.size > 10_000) {
    const now = Date.now();
    for (const [k, v] of recentlyRotated) if (v.expires < now) recentlyRotated.delete(k);
  }
};

const consumeGraceRotation = (oldHash) => {
  const entry = recentlyRotated.get(oldHash);
  if (!entry) return null;
  if (Date.now() > entry.expires) { recentlyRotated.delete(oldHash); return null; }
  return entry;
};

// --- UTILS DE SEGURANÇA ---

// Log de Auditoria
const logAudit = async (req, action, details, userId = null, email = null) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        AuditLog.create({
            user: userId,
            email: email,
            action,
            details,
            ipAddress: Array.isArray(ip) ? ip[0] : ip,
            userAgent: req.headers['user-agent']
        }).catch(err => logger.error(`Erro log: ${err.message}`));
    } catch (e) {
        // Proposital: a auditoria NUNCA pode derrubar o fluxo de auth. Falha ao
        // montar o registro (ex.: headers ausentes) é só logada em debug.
        logger.debug(`[Audit] Falha ao registrar auditoria (${action}): ${e.message}`);
    }
};

// Sanitizador de Usuário (DTO - Data Transfer Object)
// Remove campos sensíveis como IDs de pagamento, tokens, etc.
const sanitizeUser = (user) => {
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        role: user.role,
        subscriptionStatus: user.subscriptionStatus,
        validUntil: user.validUntil,
        hasSeenTutorial: user.hasSeenTutorial,
        walletName: user.walletName,
        // CPF cifrado em repouso — decrypt() trata valores legados em claro (sem ':').
        cpf: user.cpf ? decrypt(user.cpf) : user.cpf,
        phone: user.phone,
        occupation: user.occupation,
        bannerColor: user.bannerColor,
        marketingOptIn: user.marketingOptIn,
        mfaEnabled: !!user.mfaEnabled, // (I14) p/ a UI refletir o status
        // (3.17) foto de perfil — data-URL pequena (ou ausente → iniciais).
        avatar: user.avatar,
        // (3.21) novos campos de perfil. brokerage/endereço em claro;
        // birthDate/salary cifrados em repouso → devolvidos em claro ao titular.
        brokerage: user.brokerage,
        cep: user.cep,
        street: user.street,
        neighborhood: user.neighborhood,
        city: user.city,
        state: user.state,
        birthDate: user.birthDate ? decrypt(user.birthDate) : user.birthDate,
        salary: user.salary ? decrypt(user.salary) : user.salary,
    };
};

export const register = async (req, res, next) => {
  const { name, email, password, acceptedTerms, acceptedPrivacy, marketingOptIn } = req.body;
  let newUserId;
  try {
    if (!name || name.length < 2) throw new Error("Nome muito curto.");
    const pwError = getPasswordError(password);
    if (pwError) throw new Error(pwError);

    await runTransaction(async (session) => {
      const userExists = await User.findOne({ email }).session(session);
      if (userExists) throw txError(409, "Este email já está cadastrado.");

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const now = new Date();

      const newUser = new User({
        name,
        email,
        password: hashedPassword,
        role: 'USER',
        plan: 'GUEST',
        subscriptionStatus: 'ACTIVE',
        validUntil: null,
        hasSeenTutorial: false,
        // Consentimento LGPD — timestamps registrados no servidor (Art. 7, 8)
        termsAcceptedAt: acceptedTerms ? now : undefined,
        privacyAcceptedAt: acceptedPrivacy ? now : undefined,
        consentVersion: (acceptedTerms && acceptedPrivacy) ? CONSENT_VERSION : undefined,
        marketingOptIn: !!marketingOptIn,
      });

      await newUser.save({ session });
      newUserId = newUser._id;
    });
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
    return next(error);
  }

  logAudit(req, 'REGISTER_SUCCESS', 'Nova conta criada', newUserId, email);
  res.status(201).json({ message: "Conta criada com sucesso!" });
};

export const login = async (req, res, next) => {
  try {
    const { email, password, mfaToken } = req.body;

    // Seleciona os campos de MFA (select:false por padrão) para o gate abaixo.
    const user = await User.findOne({ email }).select('+mfaSecret +mfaBackupCodes');
    const invalidMsg = "Credenciais inválidas.";

    if (!user) {
        logAudit(req, 'LOGIN_FAILED', 'Usuário não encontrado', null, maskEmail(email));
        return res.status(401).json({ message: invalidMsg });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        logAudit(req, 'LOGIN_FAILED', 'Senha incorreta', user._id, maskEmail(email));
        return res.status(401).json({ message: invalidMsg });
    }

    // --- (I14) Segundo fator (opt-in) ---
    // Só afeta usuários com MFA ativo; demais seguem o fluxo normal.
    if (user.mfaEnabled) {
        if (!mfaToken) {
            // Senha OK, mas falta o 2º fator — sinaliza ao cliente sem emitir tokens.
            logAudit(req, 'LOGIN_MFA_REQUIRED', 'Aguardando segundo fator', user._id, email);
            return res.status(200).json({ mfaRequired: true });
        }

        let mfaOk = verifyTotp(mfaToken, decrypt(user.mfaSecret));
        if (!mfaOk) {
            // Fallback: código de backup (consumo único).
            const { ok, remaining } = consumeBackupCode(mfaToken, user.mfaBackupCodes);
            if (ok) {
                mfaOk = true;
                user.mfaBackupCodes = remaining;
                await user.save();
                logAudit(req, 'LOGIN_MFA_BACKUP', 'Login via código de backup', user._id, email);
            }
        }

        if (!mfaOk) {
            logAudit(req, 'LOGIN_FAILED', 'Segundo fator inválido', user._id, maskEmail(email));
            return res.status(401).json({ message: invalidMsg });
        }
    }

    // Geração de Tokens
    const accessToken = jwt.sign(
      { id: user._id, email: user.email, plan: user.plan, role: user.role }, 
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRATION }
    );

    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + REFRESH_TOKEN_EXPIRATION_DAYS);

    const refreshTokenString = jwt.sign(
      { id: user._id }, 
      JWT_REFRESH_SECRET, 
      { expiresIn: `${REFRESH_TOKEN_EXPIRATION_DAYS}d` }
    );

    await RefreshToken.create({
      token: hashToken(refreshTokenString),
      user: user._id,
      expiryDate: expiredAt,
    });

    res.cookie('jwt', refreshTokenString, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
    });

    // (1.4) Novo token CSRF a cada login — rotaciona junto com a sessão.
    issueCsrfToken(req, res, { rotate: true });

    logAudit(req, 'LOGIN_SUCCESS', 'Login via Senha', user._id, email);
    
    // [SEGURANÇA] Retorna apenas dados sanitizados
    res.status(200).json({ 
      message: "Login realizado.",
      accessToken,
      user: sanitizeUser(user)
    });

  } catch (error) {
    next(error);
  }
};

// Emite (ou reemite) o cookie de refresh e devolve o access token correspondente.
const emitSession = (req, res, user, refreshTokenString) => {
  res.cookie('jwt', refreshTokenString, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
  });
  // (1.4) Auto-cura: garante o cookie CSRF (sessões anteriores ao deploy).
  issueCsrfToken(req, res);
  return jwt.sign(
    { id: user._id, email: user.email, plan: user.plan, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRATION }
  );
};

export const refreshToken = async (req, res, next) => {
  try {
    const cookies = req.cookies;
    if (!cookies?.jwt) return res.status(401).json({ message: "Sessão inválida." });

    const requestToken = cookies.jwt;
    const requestHash = hashToken(requestToken);
    const tokenInDb = await RefreshToken.findOne({ token: requestHash });

    // Hash não está no banco: pode ser (a) uma corrida multi-aba dentro da janela
    // de graça — reemite o mesmo token novo já rotacionado; ou (b) reuso de um
    // token já consumido/roubado — revoga TODA a família como precaução.
    if (!tokenInDb) {
      const grace = consumeGraceRotation(requestHash);
      if (grace) {
        const user = await User.findById(grace.userId);
        if (user) {
          const newAccessToken = emitSession(req, res, user, grace.newTokenString);
          return res.status(200).json({ accessToken: newAccessToken });
        }
      }
      // Reuso fora da graça: se o JWT ainda é estruturalmente válido, revoga a família.
      try {
        const decoded = jwt.verify(requestToken, JWT_REFRESH_SECRET);
        if (decoded?.id) {
          await RefreshToken.deleteMany({ user: decoded.id });
          logAudit(req, 'TOKEN_REUSE_DETECTED', 'Refresh token reusado — todas as sessões revogadas', decoded.id);
        }
      } catch { /* JWT inválido/expirado: nada a revogar */ }
      logAudit(req, 'TOKEN_REFRESH_FAILED', 'Token de refresh inválido ou reusado');
      return res.status(401).json({ message: "Sessão expirada." });
    }

    if (RefreshToken.verifyExpiration(tokenInDb)) {
      await RefreshToken.findByIdAndDelete(tokenInDb._id);
      logAudit(req, 'TOKEN_REFRESH_FAILED', 'Token de refresh expirado');
      return res.status(401).json({ message: "Sessão expirada." });
    }

    const user = await User.findById(tokenInDb.user);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

    // ROTAÇÃO (uso único): invalida o token apresentado e emite um novo. Limita a
    // janela de utilidade de um refresh token vazado a uma única renovação.
    await RefreshToken.findByIdAndDelete(tokenInDb._id);

    const newRefreshTokenString = jwt.sign(
      { id: user._id },
      JWT_REFRESH_SECRET,
      { expiresIn: `${REFRESH_TOKEN_EXPIRATION_DAYS}d` }
    );
    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + REFRESH_TOKEN_EXPIRATION_DAYS);
    await RefreshToken.create({
      token: hashToken(newRefreshTokenString),
      user: user._id,
      expiryDate: expiredAt,
    });
    // Registra a rotação para a janela de graça (corrida multi-aba).
    rememberRotation(requestHash, newRefreshTokenString, user._id.toString());

    const newAccessToken = emitSession(req, res, user, newRefreshTokenString);
    res.status(200).json({ accessToken: newAccessToken });

  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    const cookies = req.cookies;
    if (cookies?.jwt) {
       await RefreshToken.findOneAndDelete({ token: hashToken(cookies.jwt) });
       res.clearCookie('jwt', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    }
    clearCsrfToken(res); // (1.4) limpa o token CSRF junto com a sessão
    res.status(200).json({ message: "Logout realizado." });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(200).json({ message: "Se o email existir, instruções foram enviadas." });

    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = hashToken(token);
    user.resetPasswordExpires = Date.now() + 1800000;
    await user.save();

    const origin = req.get('origin') || 'http://localhost:5173';
    await sendResetPasswordEmail(user.email, token, origin);

    logAudit(req, 'PASSWORD_RESET_REQUESTED', 'Link de reset enviado', user._id, user.email);
    res.status(200).json({ message: "Se o email existir, instruções foram enviadas." });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    const hashedToken = hashToken(token);
    const user = await User.findOne({ resetPasswordToken: hashedToken, resetPasswordExpires: { $gt: Date.now() } });

    if (!user) return res.status(400).json({ message: "Token inválido ou expirado." });

    const pwError = getPasswordError(newPassword);
    if (pwError) {
      return res.status(400).json({ message: pwError });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    logAudit(req, 'PASSWORD_RESET_USED', 'Senha redefinida via token', user._id, user.email);
    res.status(200).json({ message: "Senha atualizada." });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const {
            name, cpf, phone, occupation, bannerColor, walletName,
            // (3.21) novos campos de perfil
            brokerage, cep, street, neighborhood, city, state, birthDate, salary,
        } = req.body;
        const cleanCpf = cpf ? cpf.replace(/\D/g, '') : null;

        // $set ignora chaves undefined (deixa o campo inalterado quando vazio).
        const set = { name, phone: phone || undefined, occupation: occupation || undefined };
        const unset = {};

        // Nome da carteira (fase 1 multicarteira). '' → remove (volta ao rótulo padrão).
        if (walletName !== undefined) {
            const w = typeof walletName === 'string' ? walletName.trim() : '';
            if (w === '') unset.walletName = 1;
            else if (w.length > 40) return res.status(400).json({ message: "Nome da carteira muito longo (máx. 40)." });
            else set.walletName = w;
        }

        // (3.21a) Corretora — texto livre (lista conhecida + "Outra"). Só valida
        // tamanho. '' → remove a escolha.
        if (brokerage !== undefined) {
            const b = typeof brokerage === 'string' ? brokerage.trim() : '';
            if (b === '') unset.brokerage = 1;
            else if (b.length > 80) return res.status(400).json({ message: "Corretora inválida." });
            else set.brokerage = b;
        }

        // (3.21b) Endereço (ViaCEP) — campos em claro. Helper: '' → $unset.
        const addressFields = { cep, street, neighborhood, city, state };
        for (const [key, raw] of Object.entries(addressFields)) {
            if (raw === undefined) continue;
            const v = typeof raw === 'string' ? raw.trim() : '';
            if (v === '') unset[key] = 1;
            else if (v.length > 120) return res.status(400).json({ message: "Endereço inválido." });
            else set[key] = v;
        }

        // (3.21c) Data de nascimento — cifrada em repouso. Aceita YYYY-MM-DD,
        // valida que é data real e plausível (não futura, idade ≤ 120 anos).
        if (birthDate !== undefined) {
            const v = typeof birthDate === 'string' ? birthDate.trim() : '';
            if (v === '') {
                unset.birthDate = 1;
            } else {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return res.status(400).json({ message: "Data de nascimento inválida." });
                const d = new Date(`${v}T00:00:00Z`);
                const now = new Date();
                const min = new Date(); min.setUTCFullYear(now.getUTCFullYear() - 120);
                if (Number.isNaN(d.getTime()) || v !== d.toISOString().slice(0, 10) || d > now || d < min) {
                    return res.status(400).json({ message: "Data de nascimento inválida." });
                }
                set.birthDate = encrypt(v); // cifra em repouso (AES-256-GCM)
            }
        }

        // (3.21d) Salário atual — cifrado em repouso. Número não-negativo.
        if (salary !== undefined) {
            const v = (salary === null || salary === '') ? '' : salary;
            if (v === '') {
                unset.salary = 1;
            } else {
                const n = Number(v);
                if (!Number.isFinite(n) || n < 0 || n > 1e12) return res.status(400).json({ message: "Salário inválido." });
                set.salary = encrypt(String(n)); // cifra em repouso (AES-256-GCM)
            }
        }

        // Banner de perfil (3.20): só aceita presets conhecidos; '' remove a escolha
        // (volta ao gradiente padrão do plano).
        const BANNER_PRESETS = ['ocean', 'emerald', 'royal', 'sunset', 'gold', 'graphite'];
        if (bannerColor !== undefined) {
            if (bannerColor === '' || bannerColor === null) {
                unset.bannerColor = 1;
            } else if (BANNER_PRESETS.includes(bannerColor)) {
                set.bannerColor = bannerColor;
            } else {
                return res.status(400).json({ message: "Banner inválido." });
            }
        }

        if (cleanCpf) {
            if (!validateCpf(cleanCpf)) return res.status(400).json({ message: "CPF inválido." });
            // Unicidade via blind index (CPF cifrado não é comparável diretamente).
            const cpfHash = blindIndex(cleanCpf);
            const existing = await User.findOne({ cpfHash }).select('_id');
            if (existing && existing._id.toString() !== userId) return res.status(409).json({ message: "CPF já utilizado." });
            set.cpf = encrypt(cleanCpf); // cifra em repouso (AES-256-GCM)
            set.cpfHash = cpfHash;
        } else if (cpf !== undefined) {
            // Campo enviado vazio → titular quer remover o CPF. $unset evita deixar
            // cpfHash=null (que colidiria no índice único sparse entre vários usuários).
            unset.cpf = 1;
            unset.cpfHash = 1;
        }

        const updateOps = { $set: set };
        if (Object.keys(unset).length) updateOps.$unset = unset;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            updateOps,
            { new: true }
        );
        invalidateUser(userId); // (I6) nome em cache mudou → invalida

        // [SEGURANÇA] Usa o sanitizador
        res.json({ 
            message: "Perfil atualizado.", 
            user: sanitizeUser(updatedUser)
        });
    } catch (error) {
        next(error);
    }
};

// (3.17) Atualiza a foto de perfil. Recebe uma data-URL de imagem já
// redimensionada/comprimida pelo cliente (256×256). O servidor valida mime e
// tamanho — nunca confia no cliente — e guarda a string no documento do usuário.
export const updateAvatar = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { avatar } = req.body;

        if (typeof avatar !== 'string' || !avatar) {
            return res.status(400).json({ message: "Imagem ausente." });
        }
        if (avatar.length > AVATAR_MAX_LENGTH) {
            return res.status(413).json({ message: "Imagem muito grande. Tente outra foto." });
        }
        if (!AVATAR_DATAURL_RE.test(avatar)) {
            return res.status(400).json({ message: "Formato inválido. Envie PNG, JPEG ou WebP." });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: { avatar } },
            { new: true }
        );
        invalidateUser(userId);

        logAudit(req, 'AVATAR_UPDATED', 'Foto de perfil atualizada', userId, updatedUser?.email);
        res.json({ message: "Foto atualizada.", user: sanitizeUser(updatedUser) });
    } catch (error) {
        next(error);
    }
};

// (3.17) Remove a foto de perfil — volta ao fallback de iniciais.
export const removeAvatar = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $unset: { avatar: 1 } },
            { new: true }
        );
        invalidateUser(userId);

        logAudit(req, 'AVATAR_REMOVED', 'Foto de perfil removida', userId, updatedUser?.email);
        res.json({ message: "Foto removida.", user: sanitizeUser(updatedUser) });
    } catch (error) {
        next(error);
    }
};

export const changePassword = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { oldPassword, newPassword } = req.body;

        const user = await User.findById(userId);
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(401).json({ message: "Senha atual incorreta." });

        const pwError = getPasswordError(newPassword);
        if (pwError) {
          return res.status(400).json({ message: pwError });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        logAudit(req, 'PASSWORD_CHANGED', 'Senha alterada pelo usuário', user._id, user.email);
        res.json({ message: "Senha alterada." });
    } catch (error) {
        next(error);
    }
};

export const markTutorialSeen = async (req, res, next) => {
    try {
        await User.findByIdAndUpdate(req.user.id, { hasSeenTutorial: true });
        res.status(200).json({ success: true });
    } catch (error) {
        next(error);
    }
};

export const deactivateAccount = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { password } = req.body;

        if (!password) return res.status(400).json({ message: "Confirmação de senha obrigatória." });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Senha incorreta." });

        user.isActive = false;
        user.deactivatedAt = new Date();
        await user.save();

        // Remove todos os refresh tokens — invalida todas as sessões ativas
        await RefreshToken.deleteMany({ user: userId });
        invalidateUser(userId);

        logAudit(req, 'ACCOUNT_DEACTIVATED', 'Conta desativada pelo usuário', user._id, user.email);
        res.status(200).json({ message: "Conta desativada com sucesso." });
    } catch (error) {
        next(error);
    }
};

// Exportação/portabilidade de dados pessoais (Art. 18 II/V LGPD)
export const exportData = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).lean();
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        // Remove campos sensíveis/internos antes de exportar (cpfHash é índice interno)
        const { password, resetPasswordToken, resetPasswordExpires,
                mfaSecret, mfaPendingSecret, mfaBackupCodes, cpfHash, ...safeUser } = user;

        // Devolve dados cifrados em claro ao próprio titular (decrypt trata legados sem ':').
        if (safeUser.cpf) safeUser.cpf = decrypt(safeUser.cpf);
        if (safeUser.birthDate) safeUser.birthDate = decrypt(safeUser.birthDate);
        if (safeUser.salary) safeUser.salary = decrypt(safeUser.salary);

        const [
            userAssets,
            assetTransactions,
            walletSnapshots,
            investmentGoals,
            goalContributions,
            quizAttempts,
            userProgress,
            usageLogs,
        ] = await Promise.all([
            UserAsset.find({ user: userId }).lean(),
            AssetTransaction.find({ user: userId }).lean(),
            WalletSnapshot.find({ user: userId }).lean(),
            InvestmentGoal.find({ user: userId }).lean(),
            GoalContribution.find({ user: userId }).lean(),
            // QuizAttempt e UserProgress referenciam o usuário por `userId` (não `user`)
            QuizAttempt.find({ userId: userId }).lean(),
            UserProgress.find({ userId: userId }).lean(),
            UsageLog.find({ user: userId }).lean(),
        ]);

        logAudit(req, 'DATA_EXPORT', 'Exportação de dados pessoais solicitada', userId, user.email);

        res.setHeader('Content-Disposition', `attachment; filename="vertice-meus-dados-${Date.now()}.json"`);
        res.setHeader('Content-Type', 'application/json');
        res.json({
            exportedAt: new Date().toISOString(),
            user: safeUser,
            userAssets,
            assetTransactions,
            walletSnapshots,
            investmentGoals,
            goalContributions,
            quizAttempts,
            userProgress,
            usageLogs,
        });
    } catch (error) {
        next(error);
    }
};

// Exclusão definitiva / direito ao esquecimento (Art. 18 VI; 16 LGPD)
// IRREVERSÍVEL: apaga em cascata todos os dados do titular, cancela a assinatura
// recorrente no Mercado Pago e anonimiza a trilha de auditoria (retida sem PII por
// obrigação legal/segurança). Exige confirmação de senha (+ MFA, se ativo).
export const deleteAccount = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { password, mfaToken } = req.body;

        if (!password) return res.status(400).json({ message: "Confirmação de senha obrigatória." });

        // Carrega campos de MFA (select:false) para o gate de segundo fator.
        const user = await User.findById(userId).select('+mfaSecret +mfaBackupCodes');
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            logAudit(req, 'ACCOUNT_DELETE_FAILED', 'Senha incorreta na exclusão de conta', user._id, maskEmail(user.email));
            return res.status(401).json({ message: "Senha incorreta." });
        }

        // Segundo fator obrigatório quando a conta tem MFA ativo.
        if (user.mfaEnabled) {
            if (!mfaToken) {
                return res.status(401).json({ message: "Código de autenticação (2FA) obrigatório.", mfaRequired: true });
            }
            let mfaOk = verifyTotp(mfaToken, decrypt(user.mfaSecret));
            if (!mfaOk) {
                const { ok } = consumeBackupCode(mfaToken, user.mfaBackupCodes);
                mfaOk = ok;
            }
            if (!mfaOk) {
                logAudit(req, 'ACCOUNT_DELETE_FAILED', 'Segundo fator inválido na exclusão', user._id, maskEmail(user.email));
                return res.status(401).json({ message: "Código de autenticação inválido." });
            }
        }

        const emailForLog = maskEmail(user.email);

        // Cancela a assinatura recorrente no Mercado Pago (best-effort, fora da transação:
        // é uma chamada externa que não deve abortar a exclusão dos dados).
        if (user.mpSubscriptionId) {
            await paymentService.cancelSubscription(user.mpSubscriptionId);
        }

        // Exclusão em cascata atômica. Operações SEQUENCIAIS: uma sessão de transação
        // do MongoDB não permite operações concorrentes (nada de Promise.all aqui).
        await runTransaction(async (session) => {
            await UserAsset.deleteMany({ user: userId }, { session });
            await AssetTransaction.deleteMany({ user: userId }, { session });
            await WalletSnapshot.deleteMany({ user: userId }, { session });
            await InvestmentGoal.deleteMany({ user: userId }, { session });
            await GoalContribution.deleteMany({ user: userId }, { session });
            await UsageLog.deleteMany({ user: userId }, { session });
            await Transaction.deleteMany({ user: userId }, { session });
            await RefreshToken.deleteMany({ user: userId }, { session });
            // QuizAttempt/UserProgress referenciam o titular por `userId`.
            await QuizAttempt.deleteMany({ userId: userId }, { session });
            await UserProgress.deleteMany({ userId: userId }, { session });
            // Notificações pessoais: apaga. Broadcasts: remove o id da lista de leitura.
            await Notification.deleteMany({ user: userId }, { session });
            await Notification.updateMany({ readBy: userId }, { $pull: { readBy: userId } }, { session });
            // Auditoria: anonimiza (mantém a trilha de segurança sem identificar o titular).
            // O IP/userAgent permanecem sob legítimo interesse de segurança (Art. 7 IX).
            await AuditLog.updateMany({ user: userId }, { $set: { user: null, email: null } }, { session });
            // Por fim, remove o documento do usuário.
            await User.deleteOne({ _id: userId }, { session });
        });

        invalidateUser(userId);

        // Encerra a sessão atual (cookies de refresh e CSRF).
        res.clearCookie('jwt', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
        clearCsrfToken(res);

        // Trilha final anônima — não vincula ao usuário já excluído.
        logAudit(req, 'ACCOUNT_DELETED', `Conta excluída definitivamente (titular: ${emailForLog})`, null, null);

        res.status(200).json({ message: "Conta e dados excluídos permanentemente." });
    } catch (error) {
        next(error);
    }
};
