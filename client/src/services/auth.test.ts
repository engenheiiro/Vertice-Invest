
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authService } from './auth';

// Mock global do fetch para evitar chamadas de rede reais
vi.stubGlobal('fetch', vi.fn());

describe('AuthService', () => {
  // Limpa o ambiente antes de cada teste para evitar contaminação de estado
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should return true when authenticated (token exists)', () => {
    // Configura o estado: Simula que o usuário fez login salvando o token
    localStorage.setItem('accessToken', 'mock-token');
    
    // Verifica o comportamento
    expect(authService.isAuthenticated()).toBe(true);
  });

  it('should return false when not authenticated', () => {
    // Configura o estado: Garante que não há token
    localStorage.removeItem('accessToken');
    
    // Verifica o comportamento
    expect(authService.isAuthenticated()).toBe(false);
  });
});
