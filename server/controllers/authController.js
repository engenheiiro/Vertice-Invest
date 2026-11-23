
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { runTransaction, txError } from '../utils/dbTransaction.js';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
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
import GoalJourney from '../models/GoalJourney.js';
import ImportBatch from '../models/ImportBatch.js';
import SupportTicket from '../models/SupportTicket.js';
import { paymentService } from '../services/paymentService.js';
import { sendResetPasswordEmail } from '../services/emailService.js';
import logger from '../config/logger.js';
import { getPasswordError } from '../utils/passwordPolicy.js'; // (S6) política de senha
import { invalidateUser } from '../utils/userCache.js'; // (I6) bust de cache no update de perfil
import { verifySecondFactor, MFA_GUARD_FIELDS } from '../utils/mfa.js'; // (I14) MFA no login
import { decrypt } from '../utils/encryption.js'; // (S) cripto em repouso: mfaSecret + CPF
import { issueCsrfToken, clearCsrfToken } from '../middleware/csrf.js'; // (1.4) CSRF double-submit
import { buildProfileUpdate } from '../services/auth/profileUpdate.js';
import {
  hashToken, rememberRotation, consumeGraceRotation, revokeUserSessions, revokeSessionsAfterReuse,
} from '../services/auth/refreshRotation.js'; // (F5) rotação com janela de graça
import { sanitizeAcquisition } from '../utils/acquisition.js'; // origem da conta (funil)
import { anonymizeUserTickets } from '../services/supportService.js'; // LGPD: atendimento sem titular
import { serializeTicketForUser } from '../utils/supportRules.js'; // regra 12: nota interna não sai na exportação

// Mascara e-mail para logs de auditoria — ex: j***@gmail.com
const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return '[no-email]';
  const [user, domain] = email.split('@');
  if (!domain) return '[masked]';
  return `${user.charAt(0)}***@${domain}`;
};

// Hash bcrypt (custo 10, o mesmo das senhas reais) de um valor que nenhuma
// conta usa. Quando o e-mail não existe, o login comparava NADA e respondia em
// ~1ms, contra ~70ms do bcrypt de uma conta real — a diferença de tempo dizia a
// quem quisesse quais e-mails estão cadastrados, mesmo com a mensagem genérica.
// Comparar contra este hash iguala o custo dos dois caminhos.
const DUMMY_PASSWORD_HASH = '$2a$10$KybBDTS1VY/Ckc3DEozBu.bVymdtw6jlX4FJXbolZU5UBjzitOmQa';

// Versão do consentimento — incrementar ao alterar Termos ou Política de Privacidade
const CONSENT_VERSION = '1.0';

// (3.17) Avatar: limites de validação do data-URL recebido. A imagem já chega
// redimensionada (256×256) e comprimida pelo cliente; estes tetos são a defesa
// do servidor contra payloads abusivos. ~300KB de base64 cobre folgadamente
// um JPEG/WebP 256×256, abaixo do limite de 1mb do express.json (app.js).
const AVATAR_MAX_LENGTH = 400_000; // chars da data-URL
const AVATAR_DATAURL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

// Configurações
const ACCESS_TOKEN_EXPIRATION = '15m';
const REFRESH_TOKEN_EXPIRATION_DAYS = 7;

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET e JWT_REFRESH_SECRET devem estar definidos no ambiente.');
}

// URL canônica do cliente usada em links sensíveis enviados por e-mail. Nunca
// derive este valor de Origin/Host da requisição: tais headers podem ser forjados
// fora do navegador e permitiriam envenenar o link de reset de senha.
const getTrustedClientUrl = () => {
  const configuredUrl = process.env.CLIENT_URL
    || (process.env.NODE_ENV === 'production' ? null : 'http://localhost:5173');

  if (!configuredUrl) {
    throw new Error('CLIENT_URL deve estar definida em produção.');
  }

  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error('CLIENT_URL inválida. Use uma URL absoluta.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('CLIENT_URL deve usar HTTP ou HTTPS.');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('CLIENT_URL deve usar HTTPS em produção.');
  }

  return url.origin;
};

const CLIENT_URL = getTrustedClientUrl();

// --- UTILS DE SEGURANÇA ---

// Log de Auditoria
const logAudit = async (req, action, details, userId = null, email = null) => {
    try {
        // req.ip, não o X-Forwarded-For cru: o cabeçalho vem do cliente e forjava o IP
        // da trilha de auditoria. Com `trust proxy` = 1, req.ip já é o IP que o proxy viu.
        const ip = req.ip || req.socket?.remoteAddress;
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
  const { name, email, password, acceptedTerms, acceptedPrivacy, marketingOptIn, acquisition } = req.body;
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
        // Origem do primeiro toque, saneada antes de encostar no banco.
        acquisition: sanitizeAcquisition(acquisition),
      });

      // Toda conta nasce com uma carteira padrão (Fase 2 — múltiplas carteiras):
      // sem isto, o middleware resolveWallet não teria nenhuma carteira para
      // resolver no primeiro acesso à Carteira/Terminal do usuário novo.
      const defaultWallet = new Wallet({ user: newUser._id, name: 'Minha Carteira', isDefault: true });
      await defaultWallet.save({ session });
      newUser.activeWalletId = defaultWallet._id;

      await newUser.save({ session });
      newUserId = newUser._id;
    });
  } catch (error) {
    if (error.httpStatus) return res.status(error.httpStatus).json({ message: error.message });
    return next(error);
  }

  logAudit(req, 'REGISTER_SUCCESS', 'Nova conta criada', newUserId, maskEmail(email));
  res.status(201).json({ message: "Conta criada com sucesso!" });
};

export const login = async (req, res, next) => {
  try {
    const { email, password, mfaToken } = req.body;

    // Seleciona os campos de MFA (select:false por padrão) para o gate abaixo.
    const user = await User.findOne({ email }).select(`+mfaSecret +mfaBackupCodes ${MFA_GUARD_FIELDS}`);
    const invalidMsg = "Credenciais inválidas.";

    if (!user) {
        // Mesmo custo de bcrypt do caminho com usuário (ver DUMMY_PASSWORD_HASH).
        await bcrypt.compare(String(password ?? ''), DUMMY_PASSWORD_HASH);
        logAudit(req, 'LOGIN_FAILED', 'Usuário não encontrado', null, maskEmail(email));
        return res.status(401).json({ message: invalidMsg });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        logAudit(req, 'LOGIN_FAILED', 'Senha incorreta', user._id, maskEmail(email));
        return res.status(401).json({ message: invalidMsg });
    }

    // Conta desativada pelo titular não abre sessão. Antes o login emitia tokens
    // e toda chamada seguinte voltava 401 "Conta desativada" — o app entrava e
    // nada funcionava. Checado DEPOIS da senha para não revelar o estado da conta
    // a quem não a conhece.
    if (user.isActive === false) {
        logAudit(req, 'LOGIN_FAILED', 'Conta desativada', user._id, maskEmail(email));
        return res.status(403).json({ message: "Esta conta está desativada. Fale com o suporte para reativá-la." });
    }

    // --- (I14) Segundo fator (opt-in) ---
    // Só afeta usuários com MFA ativo; demais seguem o fluxo normal.
    if (user.mfaEnabled) {
        if (!mfaToken) {
            // Senha OK, mas falta o 2º fator — sinaliza ao cliente sem emitir tokens.
            logAudit(req, 'LOGIN_MFA_REQUIRED', 'Aguardando segundo fator', user._id, maskEmail(email));
            return res.status(200).json({ mfaRequired: true });
        }

        // TOTP com anti-replay + fallback de backup (consumo único), e contador
        // de erros na CONTA: 5 falhas bloqueiam o 2º fator por 15 min.
        const factor = await verifySecondFactor(User, user, mfaToken, { secret: decrypt(user.mfaSecret) });

        if (factor.ok && factor.method === 'backup') {
            logAudit(req, 'LOGIN_MFA_BACKUP', 'Login via código de backup', user._id, maskEmail(email));
        }

        if (!factor.ok) {
            logAudit(req, 'LOGIN_FAILED', factor.locked
                ? 'Segundo fator bloqueado por excesso de tentativas'
                : (factor.replay ? 'Código MFA reutilizado' : 'Segundo fator inválido'), user._id, maskEmail(email));
            if (factor.locked) {
                return res.status(429).json({ message: "Muitas tentativas do código de autenticação. Tente novamente em 15 minutos." });
            }
            return res.status(401).json({ message: invalidMsg });
        }
    }

    // Geração de Tokens
    const accessToken = jwt.sign(
      { id: user._id, email: user.email, plan: user.plan, role: user.role, sv: user.sessionVersion ?? 0 },
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

    logAudit(req, 'LOGIN_SUCCESS', 'Login via Senha', user._id, maskEmail(email));
    
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

/**
 * Depois de mudar o segundo fator, as sessões abertas ANTES da mudança não
 * podem continuar valendo: quem tinha um refresh token roubado seguia logado
 * mesmo com o titular ligando o MFA, e desligar o MFA não derrubava nada.
 * Sobe o sessionVersion (o authMiddleware recusa access tokens antigos),
 * revoga todos os refresh tokens e reemite SÓ a sessão atual — o titular
 * continua logado neste aparelho; o cliente, ao receber 401 do token velho,
 * renova pelo cookie novo. Devolve o access token novo.
 */
export const rotateSessionAfterSecurityChange = async (req, res, user) => {
  user.sessionVersion = (user.sessionVersion ?? 0) + 1;
  await user.save();
  await revokeUserSessions(user._id);
  invalidateUser(user._id);

  const refreshTokenString = signRefreshToken(user);
  await persistRefreshToken(refreshTokenString, user._id);
  return emitSession(req, res, user, refreshTokenString);
};

const signRefreshToken = (user) => jwt.sign(
  { id: user._id },
  JWT_REFRESH_SECRET,
  { expiresIn: `${REFRESH_TOKEN_EXPIRATION_DAYS}d` }
);

// Grava só o hash do refresh token, com a mesma validade do JWT.
const persistRefreshToken = (refreshTokenString, userId) => {
  const expiredAt = new Date();
  expiredAt.setDate(expiredAt.getDate() + REFRESH_TOKEN_EXPIRATION_DAYS);
  return RefreshToken.create({ token: hashToken(refreshTokenString), user: userId, expiryDate: expiredAt });
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
    { id: user._id, email: user.email, plan: user.plan, role: user.role, sv: user.sessionVersion ?? 0 },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRATION }
  );
};

const sendAccessToken = (req, res, user, refreshTokenString) => {
  const accessToken = emitSession(req, res, user, refreshTokenString);
  return res.status(200).json({ accessToken });
};

const refreshExpired = (res) => res.status(401).json({ message: "Sessão expirada." });

// Reuso fora da graça: se o JWT ainda é estruturalmente válido, registra o reuso
// e só DEPOIS tenta revogar a família (falha ao revogar é logada no serviço).
const revokeFamilyOnReuse = async (req, requestToken) => {
  let userId = null;
  try { userId = jwt.verify(requestToken, JWT_REFRESH_SECRET)?.id; } catch { /* JWT inválido/expirado */ }
  if (!userId) return;
  logAudit(req, 'TOKEN_REUSE_DETECTED', 'Refresh token reusado — todas as sessões revogadas', userId);
  await revokeSessionsAfterReuse(userId);
};

// Hash não está no banco: pode ser (a) uma corrida multi-aba dentro da janela
// de graça — reemite o mesmo token novo já rotacionado; ou (b) reuso de um
// token já consumido/roubado — revoga TODA a família como precaução.
const handleUnknownRefreshToken = async (req, res, requestToken, requestHash) => {
  const grace = consumeGraceRotation(requestHash);
  if (grace) {
    const user = await User.findById(grace.userId);
    if (user && user.isActive !== false) return sendAccessToken(req, res, user, grace.newTokenString);
  }
  await revokeFamilyOnReuse(req, requestToken);
  logAudit(req, 'TOKEN_REFRESH_FAILED', 'Token de refresh inválido ou reusado');
  return refreshExpired(res);
};

// Dono do token guardado, ou null depois de responder (expirado, sem usuário,
// conta desativada — mesmo critério do login).
const resolveRefreshUser = async (req, res, tokenInDb) => {
  if (RefreshToken.verifyExpiration(tokenInDb)) {
    await RefreshToken.findByIdAndDelete(tokenInDb._id);
    logAudit(req, 'TOKEN_REFRESH_FAILED', 'Token de refresh expirado');
    refreshExpired(res);
    return null;
  }
  const user = await User.findById(tokenInDb.user);
  if (!user) {
    res.status(404).json({ message: "Usuário não encontrado." });
    return null;
  }
  if (user.isActive === false) {
    await RefreshToken.findByIdAndDelete(tokenInDb._id);
    res.status(401).json({ message: "Conta desativada." });
    return null;
  }
  return user;
};

// Perdeu a baixa do documento: é a aba retardatária de uma corrida, que recebe
// o token do vencedor pela janela de graça — ou o token sumiu por outro motivo.
const handleLostRotation = async (req, res, requestHash, user) => {
  let grace = consumeGraceRotation(requestHash);
  if (!grace) {
    // O vencedor registra a rotação logo depois da própria baixa; dá a ele um
    // instante antes de concluir que o token sumiu por outro motivo.
    await new Promise((r) => setTimeout(r, 150));
    grace = consumeGraceRotation(requestHash);
  }
  if (grace && String(grace.userId) === String(user._id)) {
    return sendAccessToken(req, res, user, grace.newTokenString);
  }
  logAudit(req, 'TOKEN_REFRESH_FAILED', 'Refresh token consumido por outra requisição');
  return refreshExpired(res);
};

export const refreshToken = async (req, res, next) => {
  try {
    const requestToken = req.cookies?.jwt;
    if (!requestToken) return res.status(401).json({ message: "Sessão inválida." });

    const requestHash = hashToken(requestToken);
    const tokenInDb = await RefreshToken.findOne({ token: requestHash });
    if (!tokenInDb) return await handleUnknownRefreshToken(req, res, requestToken, requestHash);

    const user = await resolveRefreshUser(req, res, tokenInDb);
    if (!user) return undefined;

    // ROTAÇÃO (uso único): invalida o token apresentado e emite um novo. Limita a
    // janela de utilidade de um refresh token vazado a uma única renovação.
    //
    // A baixa é a TRAVA: só quem apaga o documento rotaciona. Antes era findOne +
    // delete sem conferir o resultado, e duas requisições simultâneas com o mesmo
    // cookie passavam as duas — cada uma criava um refresh novo, a sessão bifurcava
    // e a detecção de reuso nunca disparava.
    const newRefreshTokenString = signRefreshToken(user);
    const claimed = await RefreshToken.findOneAndDelete({ _id: tokenInDb._id });
    if (!claimed) return await handleLostRotation(req, res, requestHash, user);

    // Registrada já aqui (antes do create) para o perdedor de uma corrida a achar.
    rememberRotation(requestHash, newRefreshTokenString, user._id.toString());
    await persistRefreshToken(newRefreshTokenString, user._id);
    return sendAccessToken(req, res, user, newRefreshTokenString);
  } catch (error) {
    return next(error);
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

    await sendResetPasswordEmail(user.email, token, CLIENT_URL);

    logAudit(req, 'PASSWORD_RESET_REQUESTED', 'Link de reset enviado', user._id, maskEmail(user.email));
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
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    await user.save();
    await revokeUserSessions(user._id);
    invalidateUser(user._id);

    logAudit(req, 'PASSWORD_RESET_USED', 'Senha redefinida via token', user._id, maskEmail(user.email));
    res.status(200).json({ message: "Senha atualizada." });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        // Nome da carteira (Fase 1) foi substituído por Wallet.name — renomear
        // agora é feito via PUT /api/wallets/:walletId (walletsController.js).
        const { error, updateOps } = await buildProfileUpdate(userId, req.body);
        if (error) return res.status(error.status).json({ message: error.message });

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            updateOps,
            { new: true }
        );
        invalidateUser(userId); // (I6) nome em cache mudou → invalida

        // [SEGURANÇA] Usa o sanitizador
        return res.json({
            message: "Perfil atualizado.",
            user: sanitizeUser(updatedUser)
        });
    } catch (error) {
        return next(error);
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

        logAudit(req, 'AVATAR_UPDATED', 'Foto de perfil atualizada', userId, maskEmail(updatedUser?.email));
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

        logAudit(req, 'AVATAR_REMOVED', 'Foto de perfil removida', userId, maskEmail(updatedUser?.email));
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
        // Senha errada numa sessão VÁLIDA é 403, nunca 401: o cliente trata 401
        // como token vencido, renova a sessão e reenvia — cada erro contava duas
        // vezes no rate limiter. Vale para todas as confirmações de senha/2FA abaixo.
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(403).json({ message: "Senha atual incorreta." });

        const pwError = getPasswordError(newPassword);
        if (pwError) {
          return res.status(400).json({ message: pwError });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        user.sessionVersion = (user.sessionVersion ?? 0) + 1;
        await user.save();
        await revokeUserSessions(user._id);
        invalidateUser(user._id);

        logAudit(req, 'PASSWORD_CHANGED', 'Senha alterada pelo usuário', user._id, maskEmail(user.email));
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
        if (!isMatch) return res.status(403).json({ message: "Senha incorreta." });

        user.isActive = false;
        user.deactivatedAt = new Date();
        user.sessionVersion = (user.sessionVersion ?? 0) + 1;
        await user.save();

        // Remove todos os refresh tokens — invalida todas as sessões ativas
        await revokeUserSessions(userId);
        invalidateUser(userId);

        logAudit(req, 'ACCOUNT_DEACTIVATED', 'Conta desativada pelo usuário', user._id, maskEmail(user.email));
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
            wallets,
            userAssets,
            assetTransactions,
            walletSnapshots,
            investmentGoals,
            goalContributions,
            quizAttempts,
            userProgress,
            usageLogs,
            goalJourneys,
            importBatches,
            payments,
            notifications,
            supportTickets,
        ] = await Promise.all([
            Wallet.find({ user: userId }).lean(),
            UserAsset.find({ user: userId }).lean(),
            AssetTransaction.find({ user: userId }).lean(),
            WalletSnapshot.find({ user: userId }).lean(),
            InvestmentGoal.find({ user: userId }).lean(),
            GoalContribution.find({ user: userId }).lean(),
            // QuizAttempt e UserProgress referenciam o usuário por `userId` (não `user`)
            QuizAttempt.find({ userId: userId }).lean(),
            UserProgress.find({ userId: userId }).lean(),
            UsageLog.find({ user: userId }).lean(),
            GoalJourney.find({ user: userId }).lean(),
            ImportBatch.find({ user: userId }).lean(),
            // Histórico de pagamentos (Transaction = cobrança do plano).
            Transaction.find({ user: userId }).lean(),
            Notification.find({ user: userId }).lean(),
            SupportTicket.find({ user: userId }).lean(),
        ]);

        logAudit(req, 'DATA_EXPORT', 'Exportação de dados pessoais solicitada', userId, maskEmail(user.email));

        res.setHeader('Content-Disposition', `attachment; filename="vertice-meus-dados-${Date.now()}.json"`);
        res.setHeader('Content-Type', 'application/json');
        res.json({
            exportedAt: new Date().toISOString(),
            user: safeUser,
            wallets,
            userAssets,
            assetTransactions,
            walletSnapshots,
            investmentGoals,
            goalContributions,
            quizAttempts,
            userProgress,
            usageLogs,
            goalJourneys,
            importBatches,
            payments,
            notifications,
            // Mesmo corte da tela: nota interna, contexto técnico e etiquetas de
            // triagem ficam no servidor (regra 12).
            // messageCount refeito sobre a thread visível: o desnormalizado do modelo
            // conta também as notas internas (regra 12).
            supportTickets: supportTickets.map((t) => {
                const view = serializeTicketForUser(t);
                return { ...view, messageCount: view.messages.length };
            }),
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

        // Tipo/presença garantidos pelo deleteAccountSchema (rota). A checagem
        // fica como defesa: bcrypt.compare com não-string LANÇA e virava 500.
        if (typeof password !== 'string' || !password) return res.status(400).json({ message: "Confirmação de senha obrigatória." });

        // Carrega campos de MFA (select:false) para o gate de segundo fator.
        const user = await User.findById(userId).select(`+mfaSecret +mfaBackupCodes ${MFA_GUARD_FIELDS}`);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            logAudit(req, 'ACCOUNT_DELETE_FAILED', 'Senha incorreta na exclusão de conta', user._id, maskEmail(user.email));
            return res.status(403).json({ message: "Senha incorreta." });
        }

        // Segundo fator obrigatório quando a conta tem MFA ativo.
        if (user.mfaEnabled) {
            if (!mfaToken) {
                return res.status(403).json({ message: "Código de autenticação (2FA) obrigatório.", mfaRequired: true });
            }
            const factor = await verifySecondFactor(User, user, mfaToken, { secret: decrypt(user.mfaSecret) });
            if (!factor.ok) {
                logAudit(req, 'ACCOUNT_DELETE_FAILED', 'Segundo fator inválido na exclusão', user._id, maskEmail(user.email));
                if (factor.locked) {
                    return res.status(429).json({ message: "Muitas tentativas do código de autenticação. Tente novamente em 15 minutos." });
                }
                return res.status(403).json({ message: "Código de autenticação inválido." });
            }
        }

        const emailForLog = maskEmail(user.email);

        // Cancela a assinatura recorrente no Mercado Pago (best-effort, fora da transação:
        // é uma chamada externa que não deve abortar a exclusão dos dados).
        // Precisa ser o preapproval_id — mpSubscriptionId guarda id de PAGAMENTO
        // (legado do fluxo avulso) e o MP rejeita esse id no cancelamento.
        if (user.mpPreapprovalId) {
            await paymentService.cancelPreapproval(user.mpPreapprovalId);
        }

        // Exclusão em cascata atômica. Operações SEQUENCIAIS: uma sessão de transação
        // do MongoDB não permite operações concorrentes (nada de Promise.all aqui).
        await runTransaction(async (session) => {
            await UserAsset.deleteMany({ user: userId }, { session });
            await AssetTransaction.deleteMany({ user: userId }, { session });
            await WalletSnapshot.deleteMany({ user: userId }, { session });
            await InvestmentGoal.deleteMany({ user: userId }, { session });
            await GoalContribution.deleteMany({ user: userId }, { session });
            await GoalJourney.deleteMany({ user: userId }, { session });
            await ImportBatch.deleteMany({ user: userId }, { session });
            // Fase 2 — múltiplas carteiras: remove os documentos Wallet do titular.
            await Wallet.deleteMany({ user: userId }, { session });
            await UsageLog.deleteMany({ user: userId }, { session });
            await Transaction.deleteMany({ user: userId }, { session });
            await RefreshToken.deleteMany({ user: userId }, { session });
            // QuizAttempt/UserProgress referenciam o titular por `userId`.
            await QuizAttempt.deleteMany({ userId: userId }, { session });
            await UserProgress.deleteMany({ userId: userId }, { session });
            // Notificações pessoais: apaga. Broadcasts: remove o id da lista de leitura.
            await Notification.deleteMany({ user: userId }, { session });
            await Notification.updateMany({ readBy: userId }, { $pull: { readBy: userId } }, { session });
            // Suporte: anonimiza a thread e apaga os anexos enviados pelo titular.
            // Mesmo critério da auditoria — o atendimento é registro do negócio,
            // mas deixa de apontar para uma pessoa.
            await anonymizeUserTickets(userId, { session });
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
