
import { API_URL } from '../config';
import { User } from '../contexts/AuthContext';

interface LoginCredentials {
  email: string;
  password: string;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
}

interface AuthResponse {
  user?: User;
  accessToken?: string;
  message?: string;
}

export const authService = {
  // Wrapper para chamadas autenticadas
  async api(endpoint: string, options: RequestInit = {}) {
    let token = localStorage.getItem('accessToken');
    
    const headers = new Headers(options.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Content-Type', 'application/json');

    let response;
    try {
        response = await fetch(`${API_URL}${endpoint}`, {
          ...options,
          headers,
          credentials: 'include'
        });
    } catch (networkError) {
        throw new Error("Erro de conexão. Verifique se o servidor está rodando.");
    }

    // Lógica de Refresh Token Automático (Simplificada)
    if (response.status === 401 || response.status === 403) {
      const newToken = await this.refreshToken();
      
      if (newToken) {
        headers.set('Authorization', `Bearer ${newToken}`);
        response = await fetch(`${API_URL}${endpoint}`, {
          ...options,
          headers,
          credentials: 'include'
        });
      } else {
        this.clearSession();
        if (!endpoint.includes('/subscription/status')) {
           window.location.hash = '/login';
        }
      }
    }

    return response;
  },

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
        const response = await fetch(`${API_URL}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
          credentials: 'include' 
        });

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error(`Erro do Servidor (${response.status}): O backend pode estar offline.`);
        }

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Erro no login');

        if (data.accessToken && data.user) {
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('user', JSON.stringify(data.user));
        }
        return data;
    } catch (error: any) {
        console.error("Login Falhou:", error);
        throw error;
    }
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw new Error(responseData.message || 'Erro ao criar conta');
    }

    return responseData;
  },

  async refreshToken(): Promise<string | null> {
    try {
        const response = await fetch(`${API_URL}/api/refresh`, {
            method: 'POST',
            credentials: 'include' 
        });
        
        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('accessToken', data.accessToken);
            return data.accessToken;
        }
        return null;
    } catch (e) {
        return null;
    }
  },

  async logout() {
    try {
        await fetch(`${API_URL}/api/logout`, { 
            method: 'POST',
            credentials: 'include' 
        });
    } catch (e) {
        console.error("Erro ao notificar logout ao servidor", e);
    }
    this.clearSession();
  },

  clearSession() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
  },

  isAuthenticated(): boolean {
    const token = localStorage.getItem('accessToken');
    return !!token;
  },

  // --- MÉTODOS DE PERFIL ---

  async updateProfile(data: any) {
      const response = await this.api('/api/me', {
          method: 'PUT',
          body: JSON.stringify(data)
      });
      const resData = await response.json();
      if (!response.ok) throw new Error(resData.message || "Erro ao atualizar perfil");
      
      // Atualiza local storage se o usuário mudar
      if (resData.user) {
          localStorage.setItem('user', JSON.stringify(resData.user));
      }
      return resData;
  },

  async changePassword(data: any) {
      const response = await this.api('/api/change-password', {
          method: 'POST',
          body: JSON.stringify(data)
      });
      const resData = await response.json();
      if (!response.ok) throw new Error(resData.message || "Erro ao alterar senha");
      return resData;
  },

  // --- MÉTODOS DE RECUPERAÇÃO ---

  async forgotPassword(email: string): Promise<void> {
    const response = await fetch(`${API_URL}/api/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    if (response.status >= 500) {
        throw new Error("Erro no servidor");
    }
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const response = await fetch(`${API_URL}/api/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Falha ao redefinir senha");
    }
  }
};
