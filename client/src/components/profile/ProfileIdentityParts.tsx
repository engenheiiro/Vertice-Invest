import React from 'react';
import { ShieldCheck, Calendar, MapPin, Palette, Check, RotateCcw, Camera, Trash2, Loader2 } from 'lucide-react';
import type { BannerPreset, UserPlan } from '../../contexts/AuthContext';
import { PlanBadge } from '../ui/PlanBadge';
import { BANNER_PRESETS, accessLevel, planShieldClass, statusView } from './profileIdentityView';

interface BannerPickerProps {
    bannerColor?: BannerPreset;
    saving: boolean;
    onApply: (key: BannerPreset | '') => void;
}

/** Seletor de presets do banner, com a volta ao padrão do plano. */
const BannerPicker = ({ bannerColor, saving, onApply }: BannerPickerProps) => (
    <div className="absolute top-11 left-2 z-20 p-2.5 rounded-xl bg-panel/95 backdrop-blur-md border border-slate-700 shadow-2xl animate-fade-in">
        <div className="flex items-center gap-1.5 mb-2">
            {BANNER_PRESETS.map(preset => {
                const active = bannerColor === preset.key;
                const state = active ? 'border-white scale-110' : 'border-slate-600 hover:border-slate-400 hover:scale-105';
                return (
                    <button
                        key={preset.key}
                        onClick={() => onApply(preset.key)}
                        disabled={saving}
                        title={preset.label}
                        aria-label={`Banner ${preset.label}`}
                        className={`relative w-7 h-7 rounded-md bg-card bg-gradient-to-br ${preset.gradient} border transition-all disabled:opacity-50 ${state}`}
                    >
                        {active && <Check size={12} className="text-white absolute inset-0 m-auto drop-shadow" />}
                    </button>
                );
            })}
        </div>
        <button
            onClick={() => onApply('')}
            disabled={saving || !bannerColor}
            className={'w-full flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-400 hover:text-white py-1 rounded-md '
                + 'hover:bg-slate-800/60 transition-colors disabled:opacity-40 disabled:hover:bg-transparent'}
        >
            <RotateCcw size={10} /> Padrão do plano
        </button>
    </div>
);

interface IdentityBannerProps extends BannerPickerProps {
    hasUser: boolean;
    plan: UserPlan;
    gradient: string;
    pickerOpen: boolean;
    onToggle: () => void;
}

/** Faixa do topo: gradiente, selo do plano, botão de personalizar e o seletor. */
export const IdentityBanner = ({ hasUser, plan, gradient, pickerOpen, onToggle, ...picker }: IdentityBannerProps) => (
    <div className={`h-24 bg-gradient-to-r ${gradient} relative overflow-hidden transition-colors duration-500`}>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
        {hasUser && (
            <div className="absolute top-2 right-2">
                <PlanBadge plan={plan} />
            </div>
        )}

        {/* Botão de personalização do banner (3.20) */}
        {hasUser && (
            <button
                onClick={onToggle}
                aria-label="Personalizar banner"
                aria-expanded={pickerOpen}
                // text-[#fff]: o banner é sempre escuro (gradiente não é remapeado no
                // tema claro), mas o override de tema inverteria text-white → escuro.
                // Cor literal mantém o ícone branco e visível em ambos os temas.
                className={'absolute top-2 left-2 p-1.5 rounded-lg bg-black/40 hover:bg-black/60 backdrop-blur-sm border border-white/10 '
                    + 'text-[#fff] transition-colors'}
            >
                <Palette size={14} />
            </button>
        )}

        {pickerOpen && <BannerPicker {...picker} />}
    </div>
);

interface AvatarButtonProps {
    avatar?: string;
    initials: string;
    uploading: boolean;
    onPick: () => void;
}

/** Foto (ou iniciais) clicável, com o overlay de câmera/carregando. */
export const AvatarButton = ({ avatar, initials, uploading, onPick }: AvatarButtonProps) => (
    <button
        type="button"
        onClick={onPick}
        disabled={uploading}
        aria-label={avatar ? 'Trocar foto de perfil' : 'Adicionar foto de perfil'}
        className={'w-20 h-20 rounded-xl bg-card border-4 border-base -mt-10 flex items-center justify-center text-xl font-bold text-slate-300 '
            + 'shadow-xl relative overflow-hidden group-hover:border-slate-700 transition-colors cursor-pointer disabled:cursor-wait'}
    >
        {avatar ? (
            <img src={avatar} alt="Foto de perfil" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
            <span className="z-10">{initials}</span>
        )}
        {/* Overlay de ação no hover (ou enquanto envia) */}
        <div
            className={'absolute inset-0 bg-black/55 flex items-center justify-center transition-opacity '
                + (uploading ? 'opacity-100' : 'opacity-0 hover:opacity-100')}
        >
            {uploading
                ? <Loader2 size={18} className="text-white animate-spin" />
                : <Camera size={18} className="text-white" />}
        </div>
    </button>
);

interface IdentityDetailsProps {
    name?: string;
    email?: string;
    plan: UserPlan;
    location: string;
    subscriptionStatus?: string;
}

/** Nome com escudo do plano, e-mail, local, status e a barra de nível de acesso. */
export const IdentityDetails = ({ name, email, plan, location, subscriptionStatus }: IdentityDetailsProps) => {
    const shieldClass = planShieldClass(plan);
    const status = statusView(subscriptionStatus);
    const access = accessLevel(plan);
    const statusColor = status.active ? 'text-emerald-400' : 'text-slate-300';
    return (
        <>
            <div className="mt-4 mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    {name}
                    {shieldClass && <ShieldCheck size={16} className={shieldClass} />}
                </h2>
                <p className="text-slate-400 text-sm">{email}</p>
            </div>

            <div className="space-y-4 flex-1">
                <div className="flex items-center gap-3 text-slate-400 text-xs">
                    <MapPin size={14} />
                    <span>{location}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-400 text-xs">
                    <Calendar size={14} />
                    <span className="flex items-center gap-1.5">
                        Status:
                        <span className={`inline-flex items-center gap-1 capitalize font-bold ${statusColor}`}>
                            {status.active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>}
                            {status.label}
                        </span>
                    </span>
                </div>

                {/* Barra de reputação dinâmica (fictícia baseada no plano) */}
                <div className="pt-6 border-t border-slate-800/60">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold">Nível de Acesso</span>
                        <span className="text-[10px] text-slate-400 font-mono font-bold">{access.label}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${access.barClass}`}></div>
                    </div>
                </div>
            </div>
        </>
    );
};

interface AvatarActionsProps {
    hasAvatar: boolean;
    uploading: boolean;
    onPick: () => void;
    onRemove: () => void;
}

/** Botões do rodapé: adicionar/trocar a foto e removê-la. */
export const AvatarActions = ({ hasAvatar, uploading, onPick, onRemove }: AvatarActionsProps) => (
    <div className="py-6 mt-auto flex gap-2">
        <button
            onClick={onPick}
            disabled={uploading}
            className={'flex-1 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-bold rounded-lg '
                + 'transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-wait'}
        >
            {uploading
                ? <><Loader2 size={14} className="animate-spin" /> Enviando…</>
                : <><Camera size={14} /> {hasAvatar ? 'Trocar Foto' : 'Adicionar Foto'}</>}
        </button>
        {hasAvatar && (
            <button
                onClick={onRemove}
                disabled={uploading}
                aria-label="Remover foto de perfil"
                className={'px-3 py-2 bg-slate-800 hover:bg-red-900/40 border border-slate-700 hover:border-red-900/50 text-slate-400 '
                    + 'hover:text-red-400 text-xs font-bold rounded-lg transition-colors flex items-center justify-center disabled:opacity-50'}
            >
                <Trash2 size={14} />
            </button>
        )}
    </div>
);
