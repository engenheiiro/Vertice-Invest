import React, { Suspense, lazy, PropsWithChildren } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';

// Importações com Caminhos Relativos Explícitos (Evita erros de Alias @)
import { AuthLayout } from './components/layout/AuthLayout';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { AdminRoute } from './components/auth/AdminRoute'; // Nova Importação
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { WalletProvider } from './contexts/WalletContext';

// Pages - Eager Loading (Autenticação)
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Terms } from './pages/Terms';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Landing } from './pages/Landing'; 
import { Checkout } from './pages/Checkout';
import { CheckoutSuccess } from './pages/CheckoutSuccess';

// Lazy Loading: Pages Pesadas (Melhora performance inicial)
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Pricing = lazy(() => import('./pages/Pricing').then(module => ({ default: module.Pricing })));
const Wallet = lazy(() => import('./pages/Wallet').then(module => ({ default: module.Wallet })));
const Research = lazy(() => import('./pages/Research').then(module => ({ default: module.Research })));
const Courses = lazy(() => import('./pages/Courses').then(module => ({ default: module.Courses })));
const AdminPanel = lazy(() => import('./pages/admin/AdminPanel').then(module => ({ default: module.AdminPanel }))); // Nova Importação

// Loading Component
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#03060D]">
    <div className="flex flex-col items-center gap-6 relative">
      <div className="relative">
         <div className="absolute inset-0 bg-blue-600/20 blur-xl rounded-full animate-pulse"></div>
         <div className="w-16 h-16 bg-[#080C14] border border-blue-900/30 rounded-2xl flex items-center justify-center shadow-2xl relative z-10">
            <ShieldCheck className="w-8 h-8 text-blue-500 animate-pulse" />
         </div>
         <div className="absolute -bottom-2 -right-2">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
         </div>
      </div>
      <div className="text-center">
        <h2 className="text-white font-bold tracking-widest uppercase text-sm mb-1">Vértice Invest</h2>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Carregando Ambiente Seguro...</p>
      </div>
    </div>
  </div>
);

// Componente auxiliar para rotas públicas (Login/Register)
// Redireciona para Dashboard se já estiver logado
const PublicOnlyRoute: React.FC<PropsWithChildren> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) return <PageLoader />;
  
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};

// Componente auxiliar para a Landing Page
const LandingRoute: React.FC<PropsWithChildren> = ({ children }) => {
    return <>{children}</>;
};

// Wrapper para rotas protegidas que precisam de dados de carteira
// Garante que o WalletProvider só carregue quando o usuário estiver autenticado
const ProtectedWalletRoute: React.FC<PropsWithChildren> = ({ children }) => (
    <ProtectedRoute>
        <WalletProvider>
            {children}
        </WalletProvider>
    </ProtectedRoute>
);

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Landing Page */}
            <Route path="/" element={
                <LandingRoute>
                    <Landing />
                </LandingRoute>
            } />

            {/* Rotas de Autenticação */}
            <Route element={<AuthLayout />}>
              <Route path="/login" element={
                <PublicOnlyRoute>
                  <Login />
                </PublicOnlyRoute>
              } />
              <Route path="/register" element={
                <PublicOnlyRoute>
                  <Register />
                </PublicOnlyRoute>
              } />
              <Route path="/terms" element={<Terms />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
            </Route>

            {/* Rotas Protegidas - Core (Com Acesso à WalletProvider) */}
            <Route path="/dashboard" element={<ProtectedWalletRoute><Dashboard /></ProtectedWalletRoute>} />
            <Route path="/profile" element={<ProtectedWalletRoute><Profile /></ProtectedWalletRoute>} />
            <Route path="/pricing" element={<ProtectedWalletRoute><Pricing /></ProtectedWalletRoute>} />

            {/* Rotas Protegidas - Módulos (Novos) */}
            <Route path="/wallet" element={<ProtectedWalletRoute><Wallet /></ProtectedWalletRoute>} />
            <Route path="/research" element={<ProtectedWalletRoute><Research /></ProtectedWalletRoute>} />
            <Route path="/courses" element={<ProtectedWalletRoute><Courses /></ProtectedWalletRoute>} />

            {/* Rota ADMIN */}
            <Route path="/admin" element={
                <AdminRoute>
                    <AdminPanel />
                </AdminRoute>
            } />

            {/* Checkout */}
            <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
            <Route path="/checkout/success" element={<ProtectedRoute><CheckoutSuccess /></ProtectedRoute>} />
            
            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}