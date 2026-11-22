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

// --- Anti-replay e bloqueio por conta do segundo fator ---
//
// Antes: `verifyTotp` só respondia "o código confere". O mesmo código podia ser
// reapresentado durante toda a janela (±1 passo ≈ 90s) e não havia contador de
// erros na CONTA — o único freio era o rate limit da rota, que no login é por IP.

export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const MFA_LOCKOUT_MS = 15 * 60 * 1000;

// Campos que o chamador precisa ter carregado no documento do usuário.
export const MFA_GUARD_FIELDS = '+mfaLastUsedStep +mfaFailedAttempts +mfaLockedUntil';

/** Passo de 30s em que o código confere (dentro da janela ±1), ou null. */
export const matchTotpStep = (token, secret) => {
  if (!token || !secret) return null;
  try {
    const result = verifySync({ token: String(token).trim(), secret, window: 1 });
    return result?.valid && Number.isSafeInteger(result.timeStep) ? result.timeStep : null;
  } catch {
    return null;
  }
};

export const isMfaLocked = (user, now = Date.now()) => {
  const until = user?.mfaLockedUntil ? new Date(user.mfaLockedUntil).getTime() : 0;
  return Number.isFinite(until) && until > now;
};

export const hashBackupCode = (code) => hashCode(code);

const RESET_FAILURES = { mfaFailedAttempts: 0, mfaLockedUntil: null };

/**
 * Confere o segundo fator de uma conta com MFA ativo e REGISTRA o resultado no
 * banco, de forma atômica:
 *  - TOTP: o passo só é aceito se for MAIOR que o último usado (`updateOne`
 *    condicional — duas requisições paralelas com o mesmo código não passam
 *    as duas);
 *  - backup (se `allowBackup`): `$pull` condicional, consumo único também sob
 *    concorrência;
 *  - erro: `$inc` no contador; ao chegar em MFA_MAX_FAILED_ATTEMPTS a conta
 *    fica bloqueada por MFA_LOCKOUT_MS (e o contador recomeça).
 *
 * Retorno: `{ ok, method: 'totp'|'backup'|null, locked, replay }`.
 * `UserModel` é injetado para o util não depender do model (e ser testável).
 */
export const verifySecondFactor = async (UserModel, user, code, { secret, allowBackup = true } = {}) => {
  if (isMfaLocked(user)) return { ok: false, method: null, locked: true, replay: false };

  const userId = user._id;
  const step = matchTotpStep(code, secret);
  if (step !== null) {
    const claim = await UserModel.updateOne(
      {
        _id: userId,
        $or: [
          { mfaLastUsedStep: { $exists: false } },
          { mfaLastUsedStep: null },
          { mfaLastUsedStep: { $lt: step } },
        ],
      },
      { $set: { mfaLastUsedStep: step, ...RESET_FAILURES } },
    );
    if ((claim?.modifiedCount ?? claim?.nModified ?? 0) === 1) {
      return { ok: true, method: 'totp', locked: false, replay: false };
    }
    // Código válido mas já usado: conta como tentativa falha (é exatamente o
    // que um atacante com um código observado tentaria).
    const failure = await registerFailure(UserModel, userId);
    return { ok: false, method: null, locked: failure.locked, replay: true };
  }

  if (allowBackup && code) {
    const hashed = hashCode(code);
    const pulled = await UserModel.updateOne(
      { _id: userId, mfaBackupCodes: hashed },
      { $pull: { mfaBackupCodes: hashed }, $set: RESET_FAILURES },
    );
    if ((pulled?.modifiedCount ?? pulled?.nModified ?? 0) === 1) {
      return { ok: true, method: 'backup', locked: false, replay: false };
    }
  }

  const failure = await registerFailure(UserModel, userId);
  return { ok: false, method: null, locked: failure.locked, replay: false };
};

const registerFailure = async (UserModel, userId) => {
  const updated = await UserModel.findOneAndUpdate(
    { _id: userId },
    { $inc: { mfaFailedAttempts: 1 } },
    { new: true, projection: { mfaFailedAttempts: 1 } },
  );
  const attempts = Number(updated?.mfaFailedAttempts) || 0;
  if (attempts >= MFA_MAX_FAILED_ATTEMPTS) {
    await UserModel.updateOne(
      { _id: userId },
      { $set: { mfaFailedAttempts: 0, mfaLockedUntil: new Date(Date.now() + MFA_LOCKOUT_MS) } },
    );
    return { locked: true };
  }
  return { locked: false };
};
