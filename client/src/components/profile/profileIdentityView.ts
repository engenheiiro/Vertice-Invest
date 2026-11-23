import type { BannerPreset, UserPlan } from '../../contexts/AuthContext';

/**
 * Regras puras do cartão de identidade do Perfil: banner (preset × plano),
 * iniciais, localização, status, nível de acesso e validação da foto. Sem JSX.
 */

export const AVATAR_SIZE = 256;
const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024; // 8MB — teto do arquivo de origem

// Presets de banner escolhíveis (3.20). As chaves espelham a allowlist do
// backend (User.bannerColor / updateProfile). Strings de classe completas p/
// o JIT do Tailwind detectar.
export const BANNER_PRESETS: { key: BannerPreset; label: string; gradient: string }[] = [
    { key: 'ocean',    label: 'Oceano',   gradient: 'from-blue-900/40 to-indigo-900/40' },
    { key: 'emerald',  label: 'Esmeralda', gradient: 'from-emerald-900/40 to-slate-900' },
    { key: 'royal',    label: 'Real',     gradient: 'from-purple-900/40 to-indigo-900/40' },
    { key: 'sunset',   label: 'Pôr do sol', gradient: 'from-rose-900/40 to-orange-900/40' },
    { key: 'gold',     label: 'Ouro',     gradient: 'from-[#1a1a1a] via-slate-900 to-[#D4AF37]/10' },
    { key: 'graphite', label: 'Grafite',  gradient: 'from-slate-800 to-slate-900' },
];

// Gradiente padrão por plano (fallback quando o usuário não escolheu banner).
const PLAN_BANNER_GRADIENTS: Record<UserPlan, string> = {
    GUEST: 'from-slate-800 to-slate-900',
    ESSENTIAL: 'from-emerald-900/40 to-slate-900',
    PRO: 'from-blue-900/40 to-indigo-900/40',
    ELITE: 'from-purple-900/40 to-indigo-900/40',
    BLACK: 'from-[#1a1a1a] via-slate-900 to-[#D4AF37]/10',
};

/** Preset escolhido vence; sem preset (ou chave desconhecida), o gradiente do plano. */
export const bannerGradientFor = (plan: UserPlan, bannerColor?: string | null): string => {
    const chosen = BANNER_PRESETS.find(p => p.key === bannerColor);
    return chosen ? chosen.gradient : PLAN_BANNER_GRADIENTS[plan];
};

/** Até duas iniciais em maiúsculas; sem nome, a marca (VI). */
export const initialsOf = (name?: string | null): string =>
    name ? name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : 'VI';

/** "Cidade/UF", só a cidade, ou "Brasil" quando não há cidade. */
export const locationLabel = (city?: string | null, state?: string | null): string => {
    if (!city) return 'Brasil';
    return state ? `${city}/${state}` : city;
};

/** Rótulo do status em minúsculas (sem status, "ativo") e se pulsa como ativo. */
export const statusView = (status?: string | null): { label: string; active: boolean } => ({
    label: status?.toLowerCase() || 'ativo',
    active: status === 'ACTIVE',
});

/** Cor do escudo ao lado do nome; planos de entrada não têm escudo. */
const SHIELD_CLASS: Partial<Record<UserPlan, string>> = {
    BLACK: 'text-gold',
    ELITE: 'text-purple-400',
    PRO: 'text-blue-500',
};
export const planShieldClass = (plan: UserPlan): string | null => SHIELD_CLASS[plan] ?? null;

/** Barra de "nível de acesso" (fictícia, pelo plano): rótulo e classe de cor/largura. */
const ACCESS_LEVELS: Partial<Record<UserPlan, { label: string; barClass: string }>> = {
    BLACK: { label: 'MAX', barClass: 'bg-gold w-full' },
    ELITE: { label: 'ELITE', barClass: 'bg-purple-500 w-[88%]' },
    PRO: { label: 'HIGH', barClass: 'bg-blue-500 w-[75%]' },
};
const STANDARD_ACCESS = { label: 'STD', barClass: 'bg-emerald-500 w-[40%]' };
export const accessLevel = (plan: UserPlan): { label: string; barClass: string } => ACCESS_LEVELS[plan] ?? STANDARD_ACCESS;

/** Motivo para recusar o arquivo escolhido como foto, ou null se ele serve. */
export const avatarFileError = (file: { type: string; size: number }): string | null => {
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) return 'Formato inválido. Use PNG, JPEG ou WebP.';
    if (file.size > MAX_ORIGINAL_BYTES) return 'Imagem muito grande (máx. 8MB).';
    return null;
};

/** Aviso de sucesso ao trocar o banner: preset novo ou volta ao padrão do plano. */
export const bannerSavedMessage = (key: string): string =>
    key ? 'Banner atualizado.' : 'Banner restaurado para o padrão do plano.';
