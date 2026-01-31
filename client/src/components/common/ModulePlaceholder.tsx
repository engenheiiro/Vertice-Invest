
import React from 'react';
import { Lock, Construction, ArrowRight, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth, UserPlan } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';

interface ModulePlaceholderProps {
    title: string;
    description: string;
    minPlan: UserPlan; // Plano mínimo para acessar
    icon: React.ReactNode;
}

const PLAN_LEVELS: Record<UserPlan, number> = {
    'GUEST': 0,
    'ESSENTIAL': 1,
    'PRO': 2,
    'BLACK': 3
};

export const ModulePlaceholder: React.FC<ModulePlaceholderProps> = ({ 
    title, 
    description, 
    minPlan, 
    icon 
}) => {
    const { user } = useAuth();
    const navigate = useNavigate();

    const userLevel = PLAN_LEVELS[user?.plan || 'GUEST'];
    const requiredLevel = PLAN_LEVELS[minPlan];
    const hasAccess = userLevel >= requiredLevel;

    // --- TELA DE BLOQUEIO (UPSELL) ---
    if (!hasAccess) {
        return (
            <div className="min-h-[80vh] flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-[#080C14] border border-slate-800 rounded-2xl p-8 text-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full blur-[40px] pointer-events-none"></div>
                    
                    <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-slate-800 shadow-xl">
                        <Lock size={32} className="text-slate-500" />
                    </div>

                    <h2 className="text-2xl font-bold text-white mb-2">Acesso Restrito</h2>
                    <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                        O módulo <strong className="text-white">{title}</strong> é exclusivo para membros <span className="text-blue-400 font-bold uppercase">{minPlan}</span> ou superior.
                    </p>

                    <div className="bg-blue-900/10 border border-blue-900/30 rounded-xl p-4 mb-8 text-left">
                        <div className="flex gap-3">
                            <ShieldAlert className="text-blue-500 shrink-0" size={20} />
                            <div>
                                <p className="text-xs font-bold text-blue-200 mb-1">Por que fazer upgrade?</p>
                                <p className="text-[11px] text-blue-400/80">
                                    Desbloqueie ferramentas institucionais, dados em tempo real e relatórios exclusivos.
                                </p>
                            </div>
                        </div>
                    </div>

                    <Button onClick={() => navigate('/pricing')}>
                        Desbloquear Acesso <ArrowRight size={16} className="ml-2" />
                    </Button>
                </div>
            </div>
        );
    }

    // --- TELA DE "EM BREVE" (ACESSO PERMITIDO) ---
    return (
        <div className="min-h-[80vh] flex flex-col items-center justify-center text-center p-6 animate-fade-in">
            <div className="w-20 h-20 bg-[#0B101A] rounded-3xl flex items-center justify-center mb-6 border border-slate-800 shadow-2xl shadow-blue-900/10 relative">
                <div className="absolute inset-0 bg-blue-500/5 rounded-3xl animate-pulse"></div>
                <div className="relative text-blue-500">
                    {icon}
                </div>
            </div>

            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">{title}</h1>
            <p className="text-slate-400 max-w-lg mx-auto text-base leading-relaxed mb-8">
                {description}
                <br/>
                <span className="text-sm text-slate-500 mt-2 block">
                    Previsão de Lançamento: <span className="text-emerald-500 font-mono font-bold">Em Breve: Masterclasses Exclusivas</span>
                </span>
            </p>

            <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 rounded-full border border-slate-800 text-xs font-mono text-slate-400">
                <Construction size={12} className="text-yellow-500" />
                <span>Conteúdo em produção final</span>
            </div>
        </div>
    );
};
