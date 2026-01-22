import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/auth';

export type UserPlan = 'GUEST' | 'ESSENTIAL' | 'PRO' | 'BLACK';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIAL';
export type UserRole = 'USER' | 'ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  plan: UserPlan;
  subscriptionStatus: SubscriptionStatus;
  role: UserRole;
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
        const response = await authService.api('/api/subscription/status');
        if (response.ok) {
            const data = await response.json();
            if (data.current) {
                const updatedUser = { ...JSON.parse(localStorage.getItem('user') || '{}'), ...data.current };
                setUser(updatedUser);
                localStorage.setItem('user', JSON.stringify(updatedUser));
            }
        }
    } catch (e) {
        console.error("Erro ao atualizar perfil", e);
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      const token = localStorage.getItem('accessToken');
      const storedUser = localStorage.getItem('user');

      if (token && storedUser) {
        try {
          // Valida o token com o servidor na inicialização
          const response = await authService.api('/api/subscription/status');
          if (response.ok) {
            setUser(JSON.parse(storedUser));
          } else {
            // Se o status falhou (401/403), o wrapper já tentou refresh.
            // Se ainda não temos user, limpa tudo.
            authService.clearSession();
          }
        } catch (e) {
          authService.clearSession();
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
    await authService.logout();
    setUser(null);
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