
import { API_URL } from '../config';
import { User } from '../contexts/AuthContext';

interface LoginCredentials {
  email: string;
  password: string;
  mfaToken?: string; // (I14) segundo fator, quando a conta tem MFA ativo
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
  mfaRequired?: boolean; // (I14) senha OK, falta o segundo fator
}

// (1.4) Double-submit CSRF: lê o cookie legível `csrfToken` e o reenvia no
// header em mutações. O servidor compara header × cookie.
const CSRF_COOKIE = 'csrfToken';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

const getCookie = (name: string): string | null => {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

// Header CSRF pronto para spread em fetches que não passam pelo wrapper `api()`.
const csrfHeader = (): Record<string, string> => {
  const token = getCookie(CSRF_COOKIE);
  return token ? { 'X-CSRF-Token': token } : {};
};

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

const subscribeTokenRefresh = (cb: (token: string) => void) => {
  refreshSubscribers.push(cb);
};

const onRrefreshed = (token: string) => {
  refreshSubscribers.map((cb) => cb(token));
  refreshSubscribers = [];
};

export const authService = {
  // (1.4) Header CSRF para fetches diretos (fora do wrapper `api()`).
  csrfHeader,

  // Wrapper para chamadas autenticadas
  async api(endpoint: string, options: RequestInit = {}) {
    const token = localStorage.getItem('accessToken');
    
    const headers = new Headers(options.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Content-Type', 'application/json');

    // (1.4) Anexa o token CSRF nas mutações (o retry pós-refresh reutiliza este
    // mesmo objeto `headers`, então o token segue junto na repetição).
    const method = (options.method || 'GET').toUpperCase();
    if (MUTATING_METHODS.has(method)) {
      const csrfToken = getCookie(CSRF_COOKIE);
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
    }

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

    // Lógica de Refresh Token Automático (Queueing)
    if (response.status === 401) {
      // Cria a promessa que será resolvida quando o token for renovado
      const retryOriginalRequest = new Promise<Response>((resolve) => {
        subscribeTokenRefresh((newToken) => {
          if (!newToken) {
             resolve(response); // Retorna a original se falhou o refresh
             return;
          }
          headers.set('Authorization', `Bearer ${newToken}`);
          resolve(fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers,
            credentials: 'include'
          }));
        });
      });

      if (!isRefreshing) {
        isRefreshing = true;
        const newToken = await this.refreshToken();
        isRefreshing = false;

        if (newToken) {
          onRrefreshed(newToken);
        } else {
          this.clearSession();
          if (!window.location.hash.includes('/login') && !endpoint.includes('/subscription/status')) {
             window.location.hash = '/login';
          }
          onRrefreshed(""); // Notifica falha
        }
      }

      return retryOriginalRequest;
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

  // --- MÉTODOS DE PERFIL E TUTORIAL ---

  async updateProfile(data: any) {
      const response = await this.api('/api/me', {
          method: 'PUT',
          body: JSON.stringify(data)
      });
      const resData = await response.json();
      if (!response.ok) throw new Error(resData.message || "Erro ao atualizar perfil");
      
      if (resData.user) {
          localStorage.setItem('user', JSON.stringify(resData.user));
      }
      return resData;
  },

  async markTutorialSeen() {
      await this.api('/api/tutorial-seen', { method: 'POST' });
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

  // --- MFA / 2FA (I14) ---

  async getMfaStatus(): Promise<{ mfaEnabled: boolean }> {
      const response = await this.api('/api/mfa/status', { method: 'GET' });
      return response.json();
  },

  async setupMfa(): Promise<{ secret: string; otpauth: string; qr: string }> {
      const response = await this.api('/api/mfa/setup', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Erro ao iniciar configuração do MFA');
      return data;
  },

  async enableMfa(token: string): Promise<{ backupCodes: string[] }> {
      const response = await this.api('/api/mfa/enable', {
          method: 'POST',
          body: JSON.stringify({ token })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Código inválido');
      return data;
  },

  async disableMfa(payload: { token?: string; password?: string }): Promise<void> {
      const response = await this.api('/api/mfa/disable', {
          method: 'POST',
          body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Erro ao desativar o MFA');
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
  },

  async deactivateAccount(password: string): Promise<void> {
    const response = await this.api('/api/me/deactivate', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Falha ao desativar conta");
  }
};
