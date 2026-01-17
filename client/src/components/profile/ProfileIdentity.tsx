import React from 'react';
import { ShieldCheck, Calendar, MapPin, User } from 'lucide-react';
import { useAuth, UserPlan } from '../../contexts/AuthContext';
import { PlanBadge } from '../ui/PlanBadge';

export const ProfileIdentity = () => {
    const { user } = useAuth();
    
    // Fallback seguro
    const userPlan = user?.plan || 'GUEST';
    
    const initials = user?.name 
        ? user.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() 
        : 'VI';

    // Cores de fundo dinâmicas baseadas no plano
    const bannerGradients: Record<UserPlan, string> = {
        GUEST: "from-slate-800 to-slate-900",
        ESSENTIAL: "from-emerald-900/40 to-slate-900",
        PRO: "from-blue-900/40 to-indigo-900/40",
        BLACK: "from-[#1a1a1a] via-slate-900 to-[#D4AF37]/10"
    };

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-full relative group">
            <div className={`h-24 bg-gradient-to-r ${bannerGradients[userPlan]} relative overflow-hidden transition-colors duration-500`}>
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
                {user && (
                    <div className="absolute top-2 right-2">
                        <PlanBadge plan={userPlan} />
                    </div>
                )}
            </div>
            
            <div className="px-6 relative flex-1 flex flex-col">
                <div className="w-20 h-20 rounded-xl bg-[#0B101A] border-4 border-[#080C14] -mt-10 flex items-center justify-center text-xl font-bold text-slate-300 shadow-xl relative overflow-hidden group-hover:border-slate-700 transition-colors">
                    <span className="z-10">{initials}</span>
                    <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </div>

                <div className="mt-4 mb-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        {user?.name}
                        {userPlan === 'BLACK' && <ShieldCheck size={16} className="text-[#D4AF37]" />}
                        {userPlan === 'PRO' && <ShieldCheck size={16} className="text-blue-500" />}
                    </h2>
                    <p className="text-slate-400 text-sm">{user?.email}</p>
                </div>

                <div className="space-y-4 flex-1">
                    <div className="flex items-center gap-3 text-slate-400 text-xs">
                        <MapPin size={14} />
                        <span>Brasil</span>
                    </div>
                    <div className="flex items-center gap-3 text-slate-400 text-xs">
                        <Calendar size={14} />
                        <span>Status: <span className="capitalize text-slate-300">{user?.subscriptionStatus?.toLowerCase() || 'Ativo'}</span></span>
                    </div>
                    
                    {/* Barra de reputação dinâmica (fictícia baseada no plano) */}
                    <div className="pt-6 border-t border-slate-800/60">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-slate-500 uppercase font-bold">Nível de Acesso</span>
                            <span className="text-[10px] text-slate-400 font-mono font-bold">
                                {userPlan === 'BLACK' ? 'MAX' : userPlan === 'PRO' ? 'HIGH' : 'STD'}
                            </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div 
                                className={`h-full rounded-full transition-all duration-500 ${
                                    userPlan === 'BLACK' ? 'bg-[#D4AF37] w-full' : 
                                    userPlan === 'PRO' ? 'bg-blue-500 w-[75%]' : 
                                    'bg-emerald-500 w-[40%]'
                                }`}
                            ></div>
                        </div>
                    </div>
                </div>

                <div className="py-6 mt-auto">
                    <button className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2">
                        <User size={14} /> Editar Avatar
                    </button>
                </div>
            </div>
        </div>
    );
};