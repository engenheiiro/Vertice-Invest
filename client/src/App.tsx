
import React, { Suspense, lazy, PropsWithChildren } from 'react';
import { HashRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

// Importações com Caminhos Relativos Explícitos
import { AuthLayout } from './components/layout/AuthLayout';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { AdminRoute } from './components/auth/AdminRoute'; 
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { WalletProvider } from './contexts/WalletContext';

// Pages - Eager Loading
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Terms } from './pages/Terms';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Landing } from './pages/Landing'; 
import { Checkout } from './pages/Checkout';
import { CheckoutSuccess } from './pages/CheckoutSuccess';

// Lazy Loading
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Pricing = lazy(() => import('./pages/Pricing')); 
const Wallet = lazy(() => import('./pages/Wallet').then(module => ({ default: module.Wallet })));
const Research = lazy(() => import('./pages/Research').then(module => ({ default: module.Research })));
const Courses = lazy(() => import('./pages/Courses').then(module => ({ default: module.Courses })));
const Indicators = lazy(() => import('./pages/Indicators').then(module => ({ default: module.Indicators }))); 
const AdminPanel = lazy(() => import('./pages/admin/AdminPanel').then(module => ({ default: module.AdminPanel }))); 

// Loader Sofisticado
const PageLoader = () => (
  <div className="fixed inset-0 bg-[#02040a] flex items-center justify-center z-[9999]">
    <div className="relative flex flex-col items-center">
      <div className="absolute inset-0 bg-blue-600/20 blur-[100px] rounded-full animate-pulse"></div>
      <div className="relative z-10 w-20 h-20 flex items-center justify-center mb-8">
        <div className="absolute inset-0 border border-blue-500/30 rounded-2xl rotate-45 animate-[spin_10s_linear_infinite]"></div>
        <div className="absolute inset-0 border border-indigo-500/30 rounded-2xl -rotate-12 animate-[spin_15s_linear_infinite_reverse] scale-90"></div>
        <ShieldCheck className="w-10 h-10 text-white animate-pulse" />
      </div>
      <div className="w-32 h-1 bg-slate-800 rounded-full overflow-hidden relative z-10">
        <div className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 animate-[pulse_1.5s_ease-in-out_infinite] w-full"></div>
      </div>
      <p className="mt-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] animate-fade-in">Carregando Terminal</p>
    </div>
  </div>
);

const PublicOnlyRoute: React.FC<PropsWithChildren> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

// Layout Persistente para Rotas Protegidas
// O WalletProvider envolve o Outlet, garantindo que ele não seja desmontado na navegação
const ProtectedAppLayout = () => {
  return (
    <ProtectedRoute>
      <WalletProvider>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </WalletProvider>
    </ProtectedRoute>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          {/* Landing Page */}
          <Route path="/" element={<Landing />} />

          {/* Rotas de Autenticação */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
            <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Route>

          {/* APP PRINCIPAL - O Provider Persiste Aqui */}
          <Route element={<ProtectedAppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/research" element={<Research />} />
            <Route path="/indicators" element={<Indicators />} />
            <Route path="/courses" element={<Courses />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/pricing" element={<Pricing />} />
            
            {/* Admin aninhado mas com proteção extra */}
            <Route path="/admin" element={
                <AdminRoute>
                    <AdminPanel />
                </AdminRoute>
            } />
          </Route>

          {/* Rotas de Checkout (Fora do Layout Principal se necessário, ou dentro) */}
          <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
          <Route path="/checkout/success" element={<ProtectedRoute><CheckoutSuccess /></ProtectedRoute>} />
          
          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
