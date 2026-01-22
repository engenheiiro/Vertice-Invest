import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Loader2, Lock } from 'lucide-react';

interface AdminRouteProps {
  children: React.ReactNode;
}

export const AdminRoute: React.FC<AdminRouteProps> = ({ children }) => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-[#02040a]">
            <Loader2 className="animate-spin text-blue-600" />
        </div>
    );
  }

  // Se não estiver logado, manda para login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Se estiver logado mas não for ADMIN, manda para dashboard com aviso (opcional) ou bloqueia
  if (user?.role !== 'ADMIN') {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#02040a] text-white p-6 text-center">
            <div className="w-16 h-16 bg-red-900/20 rounded-2xl flex items-center justify-center mb-4 border border-red-900/50">
                <Lock size={32} className="text-red-500" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Acesso Restrito</h1>
            <p className="text-slate-400 max-w-md mb-6">
                Esta área é exclusiva para o comando central da Vértice Invest. Sua credencial não possui nível de autorização suficiente.
            </p>
            <Navigate to="/dashboard" />
        </div>
    );
  }

  return <>{children}</>;
};