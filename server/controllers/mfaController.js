/**
 * (I14) Controller de MFA/2FA (TOTP). Fluxo opt-in:
 *  setup  → gera segredo + QR (ainda não ativa)
 *  enable → confirma com um código do app → ativa + devolve backup codes (1x)
 *  disable→ confirma com código TOTP ou senha → desativa e zera segredos
 */
import bcrypt from 'bcryptjs';
import qrcode from 'qrcode';
import User from '../models/User.js';
import logger from '../config/logger.js';
import { invalidateUser } from '../utils/userCache.js';
import { generateMfaSecret, buildOtpAuthUrl, verifyTotp, generateBackupCodes } from '../utils/mfa.js';
import { encrypt, decrypt } from '../utils/encryption.js';

export const getMfaStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('mfaEnabled');
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
    res.json({ mfaEnabled: !!user.mfaEnabled });
  } catch (e) { next(e); }
};

export const setupMfa = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('email mfaEnabled +mfaPendingSecret');
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
    if (user.mfaEnabled) return res.status(400).json({ message: 'MFA já está ativo.' });

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
    const user = await User.findById(req.user.id).select('mfaEnabled +mfaPendingSecret +mfaSecret +mfaBackupCodes');
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
    if (user.mfaEnabled) return res.status(400).json({ message: 'MFA já está ativo.' });
    if (!user.mfaPendingSecret) return res.status(400).json({ message: 'Inicie a configuração do MFA primeiro.' });
    if (!verifyTotp(token, decrypt(user.mfaPendingSecret))) {
      return res.status(400).json({ message: 'Código inválido. Verifique o app e tente de novo.' });
    }

    const { plain, hashed } = generateBackupCodes(8);
    // mfaPendingSecret já está criptografado — move diretamente para mfaSecret
    user.mfaSecret = user.mfaPendingSecret;
    user.mfaPendingSecret = undefined;
    user.mfaEnabled = true;
    user.mfaBackupCodes = hashed;
    await user.save();
    invalidateUser(user._id);

    logger.info(`🔐 MFA ativado (user ${user._id})`);
    // Backup codes mostrados UMA vez — o cliente deve orientar a guardá-los.
    res.json({ message: 'MFA ativado com sucesso.', backupCodes: plain });
  } catch (e) { next(e); }
};

export const disableMfa = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    const user = await User.findById(req.user.id).select('mfaEnabled +mfaSecret +mfaBackupCodes +password');
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
    if (!user.mfaEnabled) return res.status(400).json({ message: 'MFA não está ativo.' });

    // Confirmação: código TOTP válido OU a senha da conta.
    let authorized = false;
    if (token && verifyTotp(token, decrypt(user.mfaSecret))) authorized = true;
    else if (password && await bcrypt.compare(password, user.password)) authorized = true;
    if (!authorized) return res.status(400).json({ message: 'Confirmação inválida (código ou senha).' });

    user.mfaEnabled = false;
    user.mfaSecret = undefined;
    user.mfaPendingSecret = undefined;
    user.mfaBackupCodes = [];
    await user.save();
    invalidateUser(user._id);

    logger.info(`🔓 MFA desativado (user ${user._id})`);
    res.json({ message: 'MFA desativado.' });
  } catch (e) { next(e); }
};
