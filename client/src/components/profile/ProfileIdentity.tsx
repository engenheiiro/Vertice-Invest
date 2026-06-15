import React, { useState } from 'react';
import { ShieldCheck, Calendar, MapPin, User, Palette, Check, RotateCcw } from 'lucide-react';
import { useAuth, UserPlan, BannerPreset } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { authService } from '../../services/auth';
import { PlanBadge } from '../ui/PlanBadge';

// Presets de banner escolhíveis (3.20). As chaves espelham a allowlist do
// backend (User.bannerColor / updateProfile). Strings de classe completas p/
// o JIT do Tailwind detectar.
const BANNER_PRESETS: { key: BannerPreset; label: string; gradient: string }[] = [
    { key: 'ocean',    label: 'Oceano',   gradient: 'from-blue-900/40 to-indigo-900/40' },
    { key: 'emerald',  label: 'Esmeralda', gradient: 'from-emerald-900/40 to-slate-900' },
    { key: 'royal',    label: 'Real',     gradient: 'from-purple-900/40 to-indigo-900/40' },
    { key: 'sunset',   label: 'Pôr do sol', gradient: 'from-rose-900/40 to-orange-900/40' },
    { key: 'gold',     label: 'Ouro',     gradient: 'from-[#1a1a1a] via-slate-900 to-[#D4AF37]/10' },
    { key: 'graphite', label: 'Grafite',  gradient: 'from-slate-800 to-slate-900' },
];

export const ProfileIdentity = () => {
    const { user, refreshProfile } = useAuth();
    const { addToast } = useToast();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    // Fallback seguro
    const userPlan = user?.plan || 'GUEST';

    const initials = user?.name
        ? user.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
        : 'VI';

    // Gradiente padrão por plano (fallback quando o usuário não escolheu banner).
    const bannerGradients: Record<UserPlan, string> = {
        GUEST: "from-slate-800 to-slate-900",
        ESSENTIAL: "from-emerald-900/40 to-slate-900",
        PRO: "from-blue-900/40 to-indigo-900/40",
        ELITE: "from-purple-900/40 to-indigo-900/40",
        BLACK: "from-[#1a1a1a] via-slate-900 to-[#D4AF37]/10"
    };

    const chosen = BANNER_PRESETS.find(p => p.key === user?.bannerColor);
    const bannerGradient = chosen ? chosen.gradient : bannerGradients[userPlan];

    const applyBanner = async (key: BannerPreset | '') => {
        if (saving) return;
        if ((user?.bannerColor || '') === key) { setPickerOpen(false); return; }
        setSaving(true);
        try {
            await authService.updateProfile({ bannerColor: key });
            await refreshProfile();
            addToast(key ? 'Banner atualizado.' : 'Banner restaurado para o padrão do plano.', 'success');
            setPickerOpen(false);
        } catch (err: any) {
            addToast(err?.message || 'Não foi possível atualizar o banner.', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-full relative group">
            <div className={`h-24 bg-gradient-to-r ${bannerGradient} relative overflow-hidden transition-colors duration-500`}>
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
                {user && (
                    <div className="absolute top-2 right-2">
                        <PlanBadge plan={userPlan} />
                    </div>
                )}

                {/* Botão de personalização do banner (3.20) */}
                {user && (
                    <button
                        onClick={() => setPickerOpen(o => !o)}
                        aria-label="Personalizar banner"
                        aria-expanded={pickerOpen}
                        // text-[#fff]: o banner é sempre escuro (gradiente não é remapeado no
                        // tema claro), mas o override de tema inverteria text-white → escuro.
                        // Cor literal mantém o ícone branco e visível em ambos os temas.
                        className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/40 hover:bg-black/60 backdrop-blur-sm border border-white/10 text-[#fff] transition-colors"
                    >
                        <Palette size={14} />
                    </button>
                )}

                {/* Seletor de presets */}
                {pickerOpen && (
                    <div className="absolute top-11 left-2 z-20 p-2.5 rounded-xl bg-panel/95 backdrop-blur-md border border-slate-700 shadow-2xl animate-fade-in">
                        <div className="flex items-center gap-1.5 mb-2">
                            {BANNER_PRESETS.map(preset => {
                                const active = user?.bannerColor === preset.key;
                                return (
                                    <button
                                        key={preset.key}
                                        onClick={() => applyBanner(preset.key)}
                                        disabled={saving}
                                        title={preset.label}
                                        aria-label={`Banner ${preset.label}`}
                                        className={`relative w-7 h-7 rounded-md bg-card bg-gradient-to-br ${preset.gradient} border transition-all disabled:opacity-50 ${
                                            active ? 'border-white scale-110' : 'border-slate-600 hover:border-slate-400 hover:scale-105'
                                        }`}
                                    >
                                        {active && <Check size={12} className="text-white absolute inset-0 m-auto drop-shadow" />}
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            onClick={() => applyBanner('')}
                            disabled={saving || !user?.bannerColor}
                            className="w-full flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-400 hover:text-white py-1 rounded-md hover:bg-slate-800/60 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                            <RotateCcw size={10} /> Padrão do plano
                        </button>
                    </div>
                )}
            </div>

            <div className="px-6 relative flex-1 flex flex-col">
                <div className="w-20 h-20 rounded-xl bg-card border-4 border-base -mt-10 flex items-center justify-center text-xl font-bold text-slate-300 shadow-xl relative overflow-hidden group-hover:border-slate-700 transition-colors">
                    <span className="z-10">{initials}</span>
                    <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </div>

                <div className="mt-4 mb-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        {user?.name}
                        {userPlan === 'BLACK' && <ShieldCheck size={16} className="text-gold" />}
                        {userPlan === 'ELITE' && <ShieldCheck size={16} className="text-purple-400" />}
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
                        <span className="flex items-center gap-1.5">
                            Status:
                            <span className={`inline-flex items-center gap-1 capitalize font-bold ${user?.subscriptionStatus === 'ACTIVE' ? 'text-emerald-400' : 'text-slate-300'}`}>
                                {user?.subscriptionStatus === 'ACTIVE' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>}
                                {user?.subscriptionStatus?.toLowerCase() || 'ativo'}
                            </span>
                        </span>
                    </div>

                    {/* Barra de reputação dinâmica (fictícia baseada no plano) */}
                    <div className="pt-6 border-t border-slate-800/60">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-slate-500 uppercase font-bold">Nível de Acesso</span>
                            <span className="text-[10px] text-slate-400 font-mono font-bold">
                                {userPlan === 'BLACK' ? 'MAX' : userPlan === 'ELITE' ? 'ELITE' : userPlan === 'PRO' ? 'HIGH' : 'STD'}
                            </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                    userPlan === 'BLACK' ? 'bg-gold w-full' :
                                    userPlan === 'ELITE' ? 'bg-purple-500 w-[88%]' :
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
