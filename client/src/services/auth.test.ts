
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authService } from './auth';

// Mock global do fetch para evitar chamadas de rede reais
vi.stubGlobal('fetch', vi.fn());

describe('AuthService', () => {
  // Limpa o ambiente antes de cada teste para evitar contaminação de estado
  beforeEach(() => {
    localStorage.clear();
    authService.clearSession();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('should return true when an in-memory token exists', () => {
    authService.setAccessToken('mock-token');
    
    // Verifica o comportamento
    expect(authService.isAuthenticated()).toBe(true);
  });

  it('should return false when not authenticated', () => {
    authService.setAccessToken(null);
    
    // Verifica o comportamento
    expect(authService.isAuthenticated()).toBe(false);
  });

  it('removes the legacy API cache when clearing a session', () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', { delete: deleteCache });
    authService.setAccessToken('mock-token');

    authService.clearSession();

    expect(deleteCache).toHaveBeenCalledWith('api-cache');
    expect(authService.isAuthenticated()).toBe(false);
  });
});
