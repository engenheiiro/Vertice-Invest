
import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, LayoutGrid, PieChart, Bot,
  GraduationCap, LogOut, Clock, User as UserIcon, Crown, Settings, BarChart3,
  Eye, EyeOff, Radar, Calculator, Target, ChevronRight, Sun, Moon
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWallet } from '../../contexts/WalletContext';
import { PlanBadge } from '../ui/PlanBadge';
import { NotificationBell } from './NotificationBell';

export const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const { isPrivacyMode, togglePrivacyMode } = useWallet();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [time, setTime] = useState(new Date());

  // Relógio em Tempo Real
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getActiveTab = () => {
      const path = location.pathname;
      if (path.includes('/dashboard')) return 'terminal';
      if (path.includes('/wallet')) return 'wallet';
      if (path.includes('/goals')) return 'goals';
      if (path.includes('/research')) return 'research';
      if (path.includes('/radar')) return 'radar';
      if (path.includes('/indicators')) return 'indicators';
      if (path.includes('/calculadora')) return 'calculadora';
      if (path.includes('/courses')) return 'courses';
      if (path.includes('/pricing')) return 'pricing';
      if (path.includes('/admin')) return 'admin';
      return '';
  };

  const activeTab = getActiveTab();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <>
    {/* (X2) Skip link: 1º foco do Tab pula a navegação e vai ao conteúdo. */}
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-blue-600 focus:text-white focus:font-bold focus:shadow-lg"
    >
      Pular para o conteúdo
    </a>
    <nav className="border-b border-slate-800 bg-deep/85 backdrop-blur-[14px] sticky top-0 z-50 pt-[env(safe-area-inset-top)]">
      <div className="max-w-[1360px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
           <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/dashboard')}>
              <div className="w-6 h-6 bg-blue-600 flex items-center justify-center rounded-md shadow-lg shadow-blue-600/20">
                 <ShieldCheck size={14} className="text-white" />
              </div>
              <span className="text-sm font-bold tracking-tight text-slate-200">VÉRTICE</span>
              {user && <PlanBadge plan={user.plan} className="ml-1" showIcon={false} />}
           </div>
           
           {/* Main Links com ID para o Tutorial */}
           <div id="tour-nav-links" className="hidden md:flex items-center gap-1">
              <Link to="/dashboard">
                <NavLink icon={<LayoutGrid size={14} />} label="Terminal" active={activeTab === 'terminal'} />
              </Link>
              <Link to="/wallet">
                 <NavLink icon={<PieChart size={14} />} label="Carteira" active={activeTab === 'wallet'} />
              </Link>
              <Link to="/goals">
                 <NavLink icon={<Target size={14} />} label="Metas" active={activeTab === 'goals'} />
              </Link>
              <Link to="/research">
                 <NavLink icon={<Bot size={14} />} label="Research" active={activeTab === 'research'} />
              </Link>
              <Link to="/radar">
                 <NavLink icon={<Radar size={14} />} label="Radar" active={activeTab === 'radar'} />
              </Link>
              <Link to="/indicators">
                 <NavLink icon={<BarChart3 size={14} />} label="Indicadores" active={activeTab === 'indicators'} />
              </Link>
              <Link to="/calculadora">
                 <NavLink icon={<Calculator size={14} />} label="Calculadora" active={activeTab === 'calculadora'} />
              </Link>
              <Link to="/courses">
                 <NavLink icon={<GraduationCap size={14} />} label="Cursos" active={activeTab === 'courses'} />
              </Link>
              <Link to="/pricing">
                 <NavLink icon={<Crown size={14} />} label="Planos" active={activeTab === 'pricing'} />
              </Link>
              
              {isAdmin && (
                  <Link to="/admin">
                     <div className={`
                        flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ml-2
                        ${activeTab === 'admin' 
                            ? 'bg-indigo-900/50 text-indigo-300 border border-indigo-700/50 shadow-sm' 
                            : 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/20 border border-transparent'}
                     `}>
                        <Settings size={14} />
                        Admin
                     </div>
                  </Link>
              )}
           </div>
        </div>

        <div className="flex items-center gap-2">

           {/* Notification Bell + Privacy Toggle + Theme Toggle */}
           <div className="flex items-center gap-1">
               <NotificationBell />
               <button
                 onClick={togglePrivacyMode}
                 className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                 title={isPrivacyMode ? "Mostrar Valores" : "Ocultar Valores"}
               >
                 {isPrivacyMode ? <EyeOff size={16} /> : <Eye size={16} />}
               </button>
               <button
                 onClick={toggleTheme}
                 className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                 title={theme === 'dark' ? "Ativar modo claro" : "Ativar modo escuro"}
               >
                 {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
               </button>
           </div>

           <div className="h-4 w-px bg-slate-800 hidden sm:block"></div>

           {/* User Info */}
           <div className="flex items-center gap-3">
              {/* Relógio desativado — manter código para reativação futura
              <div className="hidden xl:flex items-center gap-2 text-slate-400 bg-slate-900/50 px-2 py-1 rounded border border-slate-800/50">
                <Clock size={12} />
                <span className="text-[10px] font-mono font-medium">
                    {time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              */}

              <Link
                to="/profile"
                title="Abrir meu perfil"
                aria-label="Abrir meu perfil"
                className="hidden sm:flex items-center gap-2 group cursor-pointer pl-1 pr-2 py-1 rounded-lg border border-transparent hover:border-slate-700 hover:bg-slate-800/60 transition-colors"
              >
                  <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-600/40 flex items-center justify-center text-blue-300 group-hover:bg-blue-600/30 transition-colors shrink-0">
                      <span className="text-[11px] font-black uppercase">{user?.name?.trim()?.charAt(0) || <UserIcon size={12} />}</span>
                  </div>
                  <div className="text-right leading-tight">
                      <p className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors whitespace-nowrap">
                          {user?.name}
                      </p>
                      <p className="text-[10px] text-emerald-500 font-mono">ONLINE</p>
                  </div>
                  <ChevronRight size={14} className="text-slate-600 group-hover:text-blue-400 transition-colors shrink-0" />
              </Link>
              
              <button
                onClick={handleLogout}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="Sair"
              >
                  <LogOut size={16} />
              </button>
           </div>
        </div>
      </div>
      {/* Navegação mobile agora vive na BottomNav (barra inferior). */}
    </nav>
    </>
  );
};

const NavLink = ({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) => (
    <div className={`
        flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer
        ${active ? 'bg-slate-800 text-white shadow-sm border border-slate-700/50' : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'}
    `}>
        {icon}
        {label}
    </div>
);
