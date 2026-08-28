import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ThemeScope } from '../../contexts/ThemeContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // <ThemeScope> liga o tema claro (se for a preferência do usuário) só aqui dentro.
  // Vale também durante o isLoading para não piscar escuro→claro no F5 de uma rota
  // interna; se a sessão não existir, o Navigate abaixo desmonta o escopo e as
  // páginas externas (landing, login, cadastro) voltam ao escuro institucional.
  if (isLoading) {
    return (
        <>
            <ThemeScope />
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-600" />
            </div>
        </>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <>
      <ThemeScope />
      {children}
    </>
  );
};
