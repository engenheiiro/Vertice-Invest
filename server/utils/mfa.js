/**
 * (I14) Helpers de MFA/2FA por TOTP (compatível com Google Authenticator, Authy,
 * 1Password etc.) e códigos de backup.
 *
 * - TOTP via otplib. Janela de ±1 passo (30s) para tolerar pequeno desvio de
 *   relógio do celular.
 * - Backup codes: gerados em texto uma única vez; armazenados apenas como hash
 *   SHA-256 (consumo único). Nunca guardamos o código em claro.
 */
import { generateSecret, verifySync, generateURI } from 'otplib';
import crypto from 'crypto';

const ISSUER = 'Vértice Invest';

export const generateMfaSecret = () => generateSecret();

// URL otpauth:// para o QR Code (escaneado pelo app autenticador).
export const buildOtpAuthUrl = (email, secret) =>
  generateURI({ secret, label: email, issuer: ISSUER, type: 'totp' });

export const verifyTotp = (token, secret) => {
  if (!token || !secret) return false;
  try {
    // window: 1 → tolera ±1 passo (30s) para drift de relógio do celular.
    const result = verifySync({ token: String(token).trim(), secret, window: 1 });
    return !!result?.valid;
  } catch {
    return false;
  }
};

const hashCode = (code) => crypto.createHash('sha256').update(String(code).trim().toLowerCase()).digest('hex');

/** Gera `count` códigos de backup. Retorna { plain[], hashed[] }. */
export const generateBackupCodes = (count = 8) => {
  const plain = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex'); // 10 chars hex
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return { plain, hashed: plain.map(hashCode) };
};

/**
 * Verifica e CONSOME um código de backup (uso único).
 * Retorna { ok, remaining } — `remaining` é a nova lista de hashes sem o usado.
 */
export const consumeBackupCode = (code, hashedCodes = []) => {
  if (!code || !Array.isArray(hashedCodes) || hashedCodes.length === 0) {
    return { ok: false, remaining: hashedCodes || [] };
  }
  const h = hashCode(code);
  const idx = hashedCodes.indexOf(h);
  if (idx === -1) return { ok: false, remaining: hashedCodes };
  return { ok: true, remaining: hashedCodes.filter((_, i) => i !== idx) };
};
