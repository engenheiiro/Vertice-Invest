import { describe, it, expect } from 'vitest';
import {
    BANNER_PRESETS, accessLevel, avatarFileError, bannerGradientFor, bannerSavedMessage,
    initialsOf, locationLabel, planShieldClass, statusView,
} from './profileIdentityView';

describe('bannerGradientFor', () => {
    it('preset escolhido vence o gradiente do plano', () => {
        expect(bannerGradientFor('GUEST', 'sunset')).toBe('from-rose-900/40 to-orange-900/40');
    });

    it('sem preset (ou com chave desconhecida) usa o gradiente do plano', () => {
        expect(bannerGradientFor('ELITE', undefined)).toBe('from-purple-900/40 to-indigo-900/40');
        expect(bannerGradientFor('GUEST', 'neon')).toBe('from-slate-800 to-slate-900');
    });

    it('todo preset tem rótulo e gradiente', () => {
        expect(BANNER_PRESETS.map(p => p.key)).toEqual(['ocean', 'emerald', 'royal', 'sunset', 'gold', 'graphite']);
    });
});

describe('initialsOf', () => {
    it('pega as duas primeiras iniciais em maiúsculas', () => {
        expect(initialsOf('ana maria souza')).toBe('AM');
        expect(initialsOf('Zé')).toBe('Z');
    });

    it('sem nome cai na marca VI', () => {
        expect(initialsOf(undefined)).toBe('VI');
        expect(initialsOf('')).toBe('VI');
    });
});

describe('locationLabel', () => {
    it('cidade/UF, só cidade, ou Brasil', () => {
        expect(locationLabel('Recife', 'PE')).toBe('Recife/PE');
        expect(locationLabel('Recife', undefined)).toBe('Recife');
        expect(locationLabel(undefined, 'PE')).toBe('Brasil');
    });
});

describe('statusView', () => {
    it('só ACTIVE pulsa; o rótulo vem em minúsculas e o vazio vira "ativo"', () => {
        expect(statusView('ACTIVE')).toEqual({ label: 'active', active: true });
        expect(statusView('CANCELED')).toEqual({ label: 'canceled', active: false });
        expect(statusView(undefined)).toEqual({ label: 'ativo', active: false });
    });
});

describe('planShieldClass e accessLevel', () => {
    it('escudo e nível por plano; planos de entrada são STD sem escudo', () => {
        expect(planShieldClass('BLACK')).toBe('text-gold');
        expect(planShieldClass('PRO')).toBe('text-blue-500');
        expect(planShieldClass('ESSENTIAL')).toBeNull();
        expect(accessLevel('ELITE')).toEqual({ label: 'ELITE', barClass: 'bg-purple-500 w-[88%]' });
        expect(accessLevel('BLACK').label).toBe('MAX');
        expect(accessLevel('GUEST')).toEqual({ label: 'STD', barClass: 'bg-emerald-500 w-[40%]' });
    });
});

describe('avatarFileError', () => {
    it('recusa formato fora da lista e arquivo acima de 8MB', () => {
        expect(avatarFileError({ type: 'image/gif', size: 10 })).toBe('Formato inválido. Use PNG, JPEG ou WebP.');
        expect(avatarFileError({ type: 'image/png', size: 8 * 1024 * 1024 + 1 })).toBe('Imagem muito grande (máx. 8MB).');
    });

    it('aceita PNG/JPEG/WebP até 8MB exatos', () => {
        expect(avatarFileError({ type: 'image/webp', size: 8 * 1024 * 1024 })).toBeNull();
        expect(avatarFileError({ type: 'image/jpeg', size: 1 })).toBeNull();
    });
});

describe('bannerSavedMessage', () => {
    it('distingue preset novo de volta ao padrão', () => {
        expect(bannerSavedMessage('ocean')).toBe('Banner atualizado.');
        expect(bannerSavedMessage('')).toBe('Banner restaurado para o padrão do plano.');
    });
});
