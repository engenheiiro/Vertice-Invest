import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, PieChart, BrainCircuit, Radar, MoreHorizontal,
  BarChart3, Calculator, GraduationCap, Crown, User as UserIcon, Settings, LogOut, X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

/**
 * (M1/M2) Barra de navegação inferior — só no mobile (`md:hidden`).
 *
 * Padrão de apps financeiros: os 4 destinos principais ficam ao alcance do
 * polegar e o botão "Mais" abre um bottom sheet com os destinos secundários
 * (+ Sair). Substitui o drawer hambúrguer do Header no mobile.
 */
const PRIMARY = [
  { to: '/dashboard', label: 'Terminal', icon: LayoutGrid },
  { to: '/wallet', label: 'Carteira', icon: PieChart },
  { to: '/research', label: 'Research', icon: BrainCircuit },
  { to: '/radar', label: 'Radar', icon: Radar },
];

export const BottomNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  const path = location.pathname;
  const isActive = (to: string) => path === to || path.startsWith(`${to}/`);

  const secondary = [
    { to: '/indicators', label: 'Indicadores', icon: BarChart3 },
    { to: '/calculadora', label: 'Calculadora', icon: Calculator },
    { to: '/courses', label: 'Cursos', icon: GraduationCap },
    { to: '/pricing', label: 'Planos', icon: Crown },
    { to: '/profile', label: 'Meu Perfil', icon: UserIcon },
    ...(user?.role === 'ADMIN' ? [{ to: '/admin', label: 'Admin', icon: Settings }] : []),
  ];

  // "Mais" fica ativo quando estamos em qualquer destino secundário.
  const moreActive = secondary.some((s) => isActive(s.to));

  const handleLogout = async () => {
    setMoreOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <>
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Mais opções">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 bg-card border-t border-slate-800 rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-slate-200">Mais opções</span>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Fechar"
                className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {secondary.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-xl py-4 text-[11px] font-medium border transition-colors min-h-[72px]
                    ${isActive(to)
                      ? 'bg-slate-800 text-white border-slate-700/50'
                      : 'bg-base text-slate-300 border-slate-800 hover:bg-elevated'}`}
                >
                  <Icon size={20} />
                  {label}
                </Link>
              ))}
            </div>

            <button
              onClick={handleLogout}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-red-400 bg-red-900/10 border border-red-900/30 hover:bg-red-900/20 transition-colors"
            >
              <LogOut size={16} /> Sair
            </button>
          </div>
        </div>
      )}

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-[#03060D]/95 backdrop-blur-md border-t border-slate-800/60 pb-[env(safe-area-inset-bottom)]"
        aria-label="Navegação principal"
      >
        <div className="flex items-stretch justify-around h-16">
          {PRIMARY.map(({ to, label, icon: Icon }) => {
            const active = isActive(to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors
                  ${active ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                {label}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors
              ${moreActive ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal size={20} strokeWidth={moreActive ? 2.5 : 2} />
            Mais
          </button>
        </div>
      </nav>
    </>
  );
};
