
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  hasSeenTutorial?: boolean; // Campo Adicionado
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (userData: User, token: string) => void;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateUserTutorialStatus: () => void; // Nova função para atualizar o contexto localmente
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  const refreshProfile = async () => {
    try {
        const response = await authService.api('/api/subscription/status');
        if (response.ok) {
            const data = await response.json();
            if (data.current) {
                const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
                // Preserva o hasSeenTutorial se o endpoint de status não retornar ele (geralmente status retorna apenas dados de plano)
                // Mas idealmente o endpoint de 'me' ou login retorna tudo.
                // Vamos assumir que data.current tem o que precisamos ou fazemos merge.
                const updatedUser = { ...storedUser, ...data.current };
                setUser(updatedUser);
                localStorage.setItem('user', JSON.stringify(updatedUser));
            }
        }
    } catch (e) {
        console.error("Erro ao atualizar perfil", e);
    }
  };

  const updateUserTutorialStatus = () => {
      if (user) {
          const updatedUser = { ...user, hasSeenTutorial: true };
          setUser(updatedUser);
          localStorage.setItem('user', JSON.stringify(updatedUser));
      }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      const token = localStorage.getItem('accessToken');
      const storedUser = localStorage.getItem('user');

      if (token && storedUser) {
        try {
          // Validação rápida: se tiver user, seta. Se o token for inválido, o refreshProfile ou a próxima chamada de API vai falhar e deslogar.
          setUser(JSON.parse(storedUser));
        } catch (e) {
          await logout();
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
    } catch (e) {
        console.error("Erro no logout API", e);
    } finally {
        setUser(null);
        localStorage.removeItem('user');
        localStorage.removeItem('accessToken');
        
        queryClient.removeQueries();
        queryClient.clear();
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated: !!user, 
      isLoading,
      login, 
      logout,
      refreshProfile,
      updateUserTutorialStatus
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
