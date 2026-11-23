import crypto from 'crypto';
import RefreshToken from '../../models/RefreshToken.js';
import logger from '../../config/logger.js';

// O banco guarda só o sha256 do refresh token (e do token de reset de senha).
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// (F5) Rotação de refresh token com janela de graça para concorrência multi-aba.
// O cookie de refresh é COMPARTILHADO entre abas do mesmo domínio; duas abas podem
// apresentar o mesmo token simultaneamente antes de qualquer resposta rotacioná-lo.
// Sem graça, o "perdedor" da corrida receberia 401 e cairia no /login. Guardamos
// por poucos segundos o mapeamento hash-antigo → novo cookie: a aba retardatária
// recebe o MESMO novo token em vez de erro. Fora dessa janela, hash ausente = reuso.
const REFRESH_GRACE_MS = 15 * 1000;
const recentlyRotated = new Map(); // oldHash -> { newTokenString, userId, expires }

export const rememberRotation = (oldHash, newTokenString, userId) => {
  recentlyRotated.set(oldHash, { newTokenString, userId, expires: Date.now() + REFRESH_GRACE_MS });
  // Expurgo oportunístico para não crescer indefinidamente.
  if (recentlyRotated.size > 10_000) {
    const now = Date.now();
    for (const [k, v] of recentlyRotated) if (v.expires < now) recentlyRotated.delete(k);
  }
};

export const consumeGraceRotation = (oldHash) => {
  const entry = recentlyRotated.get(oldHash);
  if (!entry) return null;
  if (Date.now() > entry.expires) { recentlyRotated.delete(oldHash); return null; }
  return entry;
};

// Revoga as sessões persistidas e também a curta janela de graça em memória.
// Sem remover essa janela, um refresh token rotacionado instantes antes de um
// reset de senha ainda poderia receber um novo access token por até 15 segundos.
export const revokeUserSessions = async (userId) => {
  const normalizedUserId = String(userId);
  await RefreshToken.deleteMany({ user: userId });
  for (const [oldHash, entry] of recentlyRotated) {
    if (String(entry.userId) === normalizedUserId) recentlyRotated.delete(oldHash);
  }
};

// Revogação disparada por reuso de refresh token: a resposta é 401 de qualquer
// jeito, então falha aqui vira erro logado (só o id do usuário, nunca o token)
// em vez de exceção — antes ela caía no catch do JWT inválido e sumia.
export const revokeSessionsAfterReuse = async (userId) => {
  try {
    await revokeUserSessions(userId);
  } catch (error) {
    logger.error(`[Auth] Falha ao revogar sessões após reuso de refresh token (user ${userId}): ${error.message}`);
  }
};
