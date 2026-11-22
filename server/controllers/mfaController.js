/**
 * (I14) Controller de MFA/2FA (TOTP). Fluxo opt-in:
 *  setup  → gera segredo + QR (ainda não ativa)
 *  enable → confirma com um código do app → ativa + devolve backup codes (1x)
 *  disable→ exige o SEGUNDO FATOR (código TOTP ou de backup) → desativa e zera segredos
 *
 * Ligar ou desligar o MFA sobe o sessionVersion e revoga as outras sessões
 * (ver rotateSessionAfterSecurityChange): a sessão atual é reemitida.
 */
import bcrypt from 'bcryptjs';
import qrcode from 'qrcode';
import User from '../models/User.js';
import logger from '../config/logger.js';
import {
  generateMfaSecret,
  buildOtpAuthUrl,
  matchTotpStep,
  generateBackupCodes,
  verifySecondFactor,
  MFA_GUARD_FIELDS,
} from '../utils/mfa.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { rotateSessionAfterSecurityChange } from './authController.js';

const LOCKED_MESSAGE = 'Muitas tentativas do código de autenticação. Tente novamente em 15 minutos.';

export const getMfaStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('mfaEnabled');
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json({ mfaEnabled: !!user.mfaEnabled });
  } catch (e) { next(e); }
};

export const setupMfa = async (req, res, next) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user.id).select('email mfaEnabled +mfaPendingSecret +password');
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
    if (user.mfaEnabled) return res.status(400).json({ message: 'MFA já está ativo.' });
    if (!await bcrypt.compare(password, user.password)) {
      return res.status(403).json({ message: 'Senha atual inválida.' });
    }

    const secret = generateMfaSecret();
    user.mfaPendingSecret = encrypt(secret);
    await user.save();

    const otpauth = buildOtpAuthUrl(user.email, secret);
    const qr = await qrcode.toDataURL(otpauth);
    // Retorna o segredo em claro (entrada manual no app) + QR. Ainda NÃO ativa — falta confirmar.
    res.json({ secret, otpauth, qr });
  } catch (e) { next(e); }
};

export const enableMfa = async (req, res, next) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.user.id)
      .select('email plan role sessionVersion mfaEnabled +mfaPendingSecret +mfaSecret +mfaBackupCodes +mfaLastUsedStep');
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
    if (user.mfaEnabled) return res.status(400).json({ message: 'MFA já está ativo.' });
    if (!user.mfaPendingSecret) return res.status(400).json({ message: 'Inicie a configuração do MFA primeiro.' });
    const step = matchTotpStep(token, decrypt(user.mfaPendingSecret));
    if (step === null) {
      return res.status(400).json({ message: 'Código inválido. Verifique o app e tente de novo.' });
    }

    const { plain, hashed } = generateBackupCodes(8);
    // mfaPendingSecret já está criptografado — move diretamente para mfaSecret
    user.mfaSecret = user.mfaPendingSecret;
    user.mfaPendingSecret = undefined;
    user.mfaEnabled = true;
    user.mfaBackupCodes = hashed;
    // O código que confirmou a ativação já foi "gasto": sem isto, ele servia
    // como segundo fator num login logo em seguida (anti-replay do TOTP).
    user.mfaLastUsedStep = step;
    user.mfaFailedAttempts = 0;
    user.mfaLockedUntil = undefined;
    // Salva e derruba as sessões abertas antes do MFA existir (um refresh token
    // roubado seguiria valendo mesmo depois de o titular se proteger).
    const accessToken = await rotateSessionAfterSecurityChange(req, res, user);

    logger.info(`🔐 MFA ativado (user ${user._id})`);
    // Backup codes mostrados UMA vez — o cliente deve orientar a guardá-los.
    res.json({ message: 'MFA ativado com sucesso.', backupCodes: plain, accessToken });
  } catch (e) { next(e); }
};

export const disableMfa = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    const user = await User.findById(req.user.id)
      .select(`email plan role sessionVersion mfaEnabled +mfaSecret +mfaBackupCodes +password ${MFA_GUARD_FIELDS}`);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
    if (!user.mfaEnabled) return res.status(400).json({ message: 'MFA não está ativo.' });

    // Antes bastava a SENHA para desligar o MFA — justamente o fator que o MFA
    // existe para não bastar: uma sessão sequestrada com a senha vazada removia
    // a proteção sozinha. Agora o segundo fator é obrigatório (TOTP do app ou um
    // código de backup, para quem perdeu o aparelho), com o mesmo anti-replay e
    // bloqueio por conta do login. A senha, se vier, também é conferida.
    if (!token) {
      return res.status(400).json({ message: 'Informe o código do app autenticador (ou um código de backup).' });
    }
    if (password !== undefined && !await bcrypt.compare(password, user.password)) {
      return res.status(403).json({ message: 'Senha atual inválida.' });
    }

    const factor = await verifySecondFactor(User, user, token, { secret: decrypt(user.mfaSecret) });
    if (!factor.ok) {
      if (factor.locked) return res.status(429).json({ message: LOCKED_MESSAGE });
      return res.status(400).json({ message: 'Código de autenticação inválido.' });
    }

    user.mfaEnabled = false;
    user.mfaSecret = undefined;
    user.mfaPendingSecret = undefined;
    user.mfaBackupCodes = [];
    user.mfaLastUsedStep = undefined;
    user.mfaFailedAttempts = 0;
    user.mfaLockedUntil = undefined;
    const accessToken = await rotateSessionAfterSecurityChange(req, res, user);

    logger.info(`🔓 MFA desativado (user ${user._id})`);
    res.json({ message: 'MFA desativado.', accessToken });
  } catch (e) { next(e); }
};
