
import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, LayoutGrid, PieChart, Bot,
  GraduationCap, LogOut, Clock, User as UserIcon, Crown, Settings, BarChart3,
  Eye, EyeOff, Radar, Calculator, Target, ChevronRight, ChevronDown, Sun, Moon
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
           
           {/* Main Links com ID para o Tutorial. Agrupados em submenus (hover/foco)
               p/ enxugar o topo: Carteira (sua grana), Análise (descoberta), Ferramentas. */}
           <div id="tour-nav-links" className="hidden md:flex items-center gap-1">
              <Link to="/dashboard">
                <NavLink icon={<LayoutGrid size={14} />} label="Terminal" active={activeTab === 'terminal'} />
              </Link>

              <NavGroup
                label="Carteira"
                icon={<PieChart size={14} />}
                currentPath={location.pathname}
                onNavigate={navigate}
                items={[
                  { to: '/wallet', label: 'Carteira', icon: <PieChart size={14} /> },
                  { to: '/goals',  label: 'Metas',    icon: <Target size={14} /> },
                ]}
              />

              <NavGroup
                label="Análise"
                icon={<Bot size={14} />}
                currentPath={location.pathname}
                onNavigate={navigate}
                items={[
                  { to: '/research',   label: 'Research',     icon: <Bot size={14} /> },
                  { to: '/radar',      label: 'Radar',        icon: <Radar size={14} /> },
                  { to: '/indicators', label: 'Indicadores',  icon: <BarChart3 size={14} /> },
                ]}
              />

              <NavGroup
                label="Ferramentas"
                icon={<Calculator size={14} />}
                currentPath={location.pathname}
                onNavigate={navigate}
                items={[
                  { to: '/calculadora', label: 'Calculadora', icon: <Calculator size={14} /> },
                  { to: '/courses',     label: 'Cursos',      icon: <GraduationCap size={14} /> },
                ]}
              />

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

interface NavItem { to: string; label: string; icon: React.ReactNode; }

/**
 * Grupo de navegação com submenu que abre no hover (e no foco por teclado, via
 * group-focus-within). O gatilho navega para o 1º item ao clicar; fica "ativo"
 * quando a rota atual pertence a qualquer item do grupo. O `pt-2` do painel serve
 * de ponte invisível p/ o mouse não perder o hover ao descer do gatilho ao menu.
 */
const NavGroup = ({ label, icon, items, currentPath, onNavigate }: {
    label: string;
    icon: React.ReactNode;
    items: NavItem[];
    currentPath: string;
    onNavigate: (to: string) => void;
}) => {
    const isOn = (to: string) => currentPath === to || currentPath.startsWith(`${to}/`);
    const active = items.some((i) => isOn(i.to));

    return (
        <div className="relative group">
            <button
                type="button"
                onClick={() => onNavigate(items[0].to)}
                aria-haspopup="menu"
                className={`
                    flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer
                    ${active ? 'bg-slate-800 text-white shadow-sm border border-slate-700/50' : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'}
                `}
            >
                {icon}
                {label}
                <ChevronDown size={12} className="opacity-70 transition-transform duration-200 group-hover:rotate-180" />
            </button>

            <div className="absolute left-0 top-full pt-2 min-w-[13rem] z-50 opacity-0 invisible -translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:visible group-focus-within:translate-y-0">
                <div className="bg-card border border-slate-800 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5">
                    {items.map((it) => (
                        <Link
                            key={it.to}
                            to={it.to}
                            aria-current={isOn(it.to) ? 'page' : undefined}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${isOn(it.to) ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'}`}
                        >
                            <span className={isOn(it.to) ? 'text-blue-400' : 'text-slate-500'}>{it.icon}</span>
                            {it.label}
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
};
