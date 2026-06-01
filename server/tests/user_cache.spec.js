/**
 * I6 — cache de usuário (plano/role) do authMiddleware.
 * TTL curto setado por env ANTES do import para testar expiração determinística.
 */
import { describe, it, expect, beforeEach } from 'vitest';

process.env.PLAN_CACHE_TTL_MS = '40';
const { getCachedUser, setCachedUser, invalidateUser, clearUserCache, _cacheSize } =
  await import('../utils/userCache.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => clearUserCache());

describe('userCache', () => {
  it('set + get devolve o dado e aceita id numérico ou string', () => {
    setCachedUser('u1', { id: 'u1', plan: 'PRO' });
    expect(getCachedUser('u1')).toEqual({ id: 'u1', plan: 'PRO' });
    // chave normalizada para string
    setCachedUser(123, { id: '123' });
    expect(getCachedUser('123')).toEqual({ id: '123' });
  });

  it('miss devolve null', () => {
    expect(getCachedUser('inexistente')).toBeNull();
  });

  it('expira após o TTL', async () => {
    setCachedUser('u1', { id: 'u1' });
    expect(getCachedUser('u1')).not.toBeNull();
    await sleep(60); // > 40ms
    expect(getCachedUser('u1')).toBeNull();
  });

  it('invalidateUser remove só a entrada alvo', () => {
    setCachedUser('a', { id: 'a' });
    setCachedUser('b', { id: 'b' });
    invalidateUser('a');
    expect(getCachedUser('a')).toBeNull();
    expect(getCachedUser('b')).not.toBeNull();
  });

  it('clearUserCache esvazia tudo', () => {
    setCachedUser('a', { id: 'a' });
    setCachedUser('b', { id: 'b' });
    clearUserCache();
    expect(_cacheSize()).toBe(0);
  });
});
