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
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
      credentials: 'include' 
    });

    // Lê como texto primeiro para evitar crash em caso de resposta vazia ou HTML
    const text = await response.text();
    let data: any;

    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        console.error("Resposta inválida do servidor:", text);
        throw new Error(`Erro de comunicação: O servidor retornou uma resposta não-JSON. (Status: ${response.status})`);
    }

    if (!response.ok) {
      throw new Error(data.message || `Erro ${response.status}: Falha ao realizar login`);
    }

    if (data.accessToken && data.user) {
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
    }

    return data;
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const text = await response.text();
    let responseData: any;

    try {
        responseData = text ? JSON.parse(text) : {};
    } catch (e) {
         throw new Error(`Erro de comunicação: Resposta inválida do servidor. (Status: ${response.status})`);
    }

    if (!response.ok) {
      throw new Error(responseData.message || 'Erro ao criar conta');
    }

    return responseData;
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
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
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

    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        throw new Error("Erro ao processar resposta do servidor");
    }

    if (!response.ok) {
        throw new Error(data.message || "Falha ao redefinir senha");
    }
  },

  isAuthenticated(): boolean {
    const token = localStorage.getItem('accessToken');
    return !!token;
  }
};