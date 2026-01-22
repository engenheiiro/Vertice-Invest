import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, LayoutGrid, PieChart, BrainCircuit, 
  GraduationCap, LogOut, Clock, User as UserIcon, Crown, Settings
} from 'lucide-react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { PlanBadge } from '../ui/PlanBadge';

export const Header: React.FC = () => {
  const { user, logout } = useAuth();
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

  // Determina a aba ativa baseada na URL
  const getActiveTab = () => {
      const path = location.pathname;
      if (path.includes('/dashboard')) return 'terminal';
      if (path.includes('/wallet')) return 'wallet';
      if (path.includes('/research')) return 'research';
      if (path.includes('/courses')) return 'courses';
      if (path.includes('/pricing')) return 'pricing';
      if (path.includes('/admin')) return 'admin';
      return '';
  };

  const activeTab = getActiveTab();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <nav className="border-b border-slate-800/60 bg-[#03060D]/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
           <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/dashboard')}>
              <div className="w-6 h-6 bg-blue-600 flex items-center justify-center rounded-md shadow-lg shadow-blue-600/20">
                 <ShieldCheck size={14} className="text-white" />
              </div>
              <span className="text-sm font-bold tracking-tight text-slate-200">VÉRTICE</span>
              {user && <PlanBadge plan={user.plan} className="ml-1" showIcon={false} />}
           </div>
           
           {/* Main Links */}
           <div className="hidden md:flex items-center gap-1">
              <Link to="/dashboard">
                <NavLink icon={<LayoutGrid size={14} />} label="Terminal" active={activeTab === 'terminal'} />
              </Link>
              <Link to="/wallet">
                 <NavLink icon={<PieChart size={14} />} label="Carteira" active={activeTab === 'wallet'} />
              </Link>
              <Link to="/research">
                 <NavLink icon={<BrainCircuit size={14} />} label="Research" active={activeTab === 'research'} />
              </Link>
              <Link to="/courses">
                 <NavLink icon={<GraduationCap size={14} />} label="Cursos" active={activeTab === 'courses'} />
              </Link>
              <Link to="/pricing">
                 <NavLink icon={<Crown size={14} />} label="Planos" active={activeTab === 'pricing'} />
              </Link>
              
              {/* ADMIN LINK (Visível apenas para admins) */}
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

        <div className="flex items-center gap-4">
           {/* Relógio & User Info */}
           <div className="flex items-center gap-3">
              <div className="hidden xl:flex items-center gap-2 text-slate-400 bg-slate-900/50 px-2 py-1 rounded border border-slate-800/50">
                <Clock size={12} />
                <span className="text-[10px] font-mono font-medium">
                    {time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Área do Usuário Clicável */}
              <Link to="/profile" className="hidden sm:block text-right group cursor-pointer">
                  <p className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors flex items-center justify-end gap-1.5 whitespace-nowrap">
                      {user?.name}
                      <UserIcon size={10} className="text-slate-500 group-hover:text-blue-500 transition-colors" />
                  </p>
                  <p className="text-[10px] text-emerald-500 font-mono">ONLINE</p>
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
    </nav>
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