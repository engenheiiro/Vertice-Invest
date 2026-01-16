import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/auth';
import { API_URL } from '@/config';

export type UserPlan = 'GUEST' | 'ESSENTIAL' | 'PRO' | 'BLACK';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIAL';

export interface User {
  id: string;
  name: string;
  email: string;
  plan: UserPlan;
  subscriptionStatus: SubscriptionStatus;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (userData: User, token: string) => void;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfile = async () => {
    try {
        const token = localStorage.getItem('accessToken');
        if (!token) return;

        // Assumindo um endpoint que retorna o usuário atualizado (reuso do endpoint de status ou novo)
        const response = await fetch(`${API_URL}/api/subscription/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.current) {
                // Merge dos dados novos com os existentes (nome/email mantidos)
                setUser(prev => prev ? { ...prev, ...data.current } : null);
                // Atualiza storage
                const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
                const updatedUser = { ...storedUser, ...data.current };
                localStorage.setItem('user', JSON.stringify(updatedUser));
            }
        }
    } catch (e) {
        console.error("Erro ao atualizar perfil", e);
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      const storedUser = localStorage.getItem('user');
      const token = localStorage.getItem('accessToken');

      if (storedUser && token) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {
          console.error("Erro ao parsear usuário", e);
          localStorage.removeItem('user');
          localStorage.removeItem('accessToken');
        }
      }
      setIsLoading(false);
    };

    initializeAuth();
  }, []);

  const login = (userData: User, token: string) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('accessToken', token);
  };

  const logout = async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error("Erro no logout", error);
    } finally {
      setUser(null);
      localStorage.removeItem('user');
      localStorage.removeItem('accessToken');
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated: !!user, 
      isLoading,
      login, 
      logout,
      refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};