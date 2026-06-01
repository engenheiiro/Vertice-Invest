/**
 * (I6) Cache em memória do usuário autenticado (plano/role/assinatura).
 *
 * O authMiddleware roda em TODO request autenticado e fazia um `User.findById`
 * a cada um. Como esses campos mudam raramente, cacheamos por um TTL curto e
 * invalidamos explicitamente nos pontos de mutação (upgrade via checkout/webhook,
 * downgrade por expiração, edição de perfil). Assim cortamos a grande maioria
 * das leituras sem servir plano obsoleto.
 *
 * In-process (Map): suficiente para 1 instância. Em multi-instância, trocar por
 * Redis (ver I3) — a interface aqui foi mantida pequena de propósito.
 */

const TTL_MS = parseInt(process.env.PLAN_CACHE_TTL_MS, 10) || 5 * 60 * 1000; // 5min
const MAX_ENTRIES = 50_000; // guarda anti-memory-leak

const cache = new Map(); // userId(string) -> { data, expires }

export const getCachedUser = (userId) => {
  const key = String(userId);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
};

export const setCachedUser = (userId, data) => {
  // Reset simples se estourar o teto — evita crescimento ilimitado sob carga.
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(String(userId), { data, expires: Date.now() + TTL_MS });
};

export const invalidateUser = (userId) => cache.delete(String(userId));

export const clearUserCache = () => cache.clear();

// Exposto para testes/observabilidade.
export const _cacheSize = () => cache.size;
export const TTL_MS_VALUE = TTL_MS;
