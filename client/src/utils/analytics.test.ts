import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    captureAcquisition,
    clearAcquisition,
    readAcquisition,
    trackEvent,
    trackPageView,
} from './analytics';
import { CONSENT_STORAGE_KEY } from './analyticsConsent';

/**
 * Medição do funil, lado do navegador.
 *
 * Duas garantias: nenhum evento escapa para o Google sem permissão, e a origem
 * do visitante é do PRIMEIRO toque. A segunda parece detalhe e não é — capturar
 * a cada página faria todo cadastro parecer vindo de '/pricing', e a decisão de
 * onde investir em divulgação sairia dessa medição.
 */

const gtag = vi.fn();

const comConsentimento = (escolha: 'granted' | 'denied' | null) => {
    if (escolha === null) localStorage.removeItem(CONSENT_STORAGE_KEY);
    else localStorage.setItem(CONSENT_STORAGE_KEY, escolha);
};

const naPagina = (url: string, referrer = '') => {
    Object.defineProperty(window, 'location', {
        configurable: true, writable: true, value: new URL(url),
    });
    Object.defineProperty(document, 'referrer', { configurable: true, value: referrer });
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    (window as any).gtag = gtag;
    naPagina('https://verticeinvest.com.br/');
});

describe('Eventos para o Google', () => {
    it('não envia nada sem permissão', () => {
        comConsentimento(null);

        expect(trackEvent('sign_up')).toBe(false);
        expect(gtag).not.toHaveBeenCalled();
    });

    it('não envia nada depois de uma recusa', () => {
        comConsentimento('denied');

        expect(trackEvent('purchase', { value: 598.8 })).toBe(false);
        expect(gtag).not.toHaveBeenCalled();
    });

    it('envia com permissão', () => {
        comConsentimento('granted');

        expect(trackEvent('begin_checkout', { plan: 'PRO' })).toBe(true);
        expect(gtag).toHaveBeenCalledWith('event', 'begin_checkout', { plan: 'PRO' });
    });

    it('não quebra se a tag ainda não carregou', () => {
        // O script é assíncrono: o usuário pode clicar antes de ele chegar.
        comConsentimento('granted');
        delete (window as any).gtag;

        expect(() => trackEvent('sign_up')).not.toThrow();
        expect(trackEvent('sign_up')).toBe(false);
    });

    it('registra página vista a cada rota', () => {
        // O `config` do gtag dispara uma vez, no carregamento. Sem isto, todo
        // visitante de uma SPA pareceria ter visto exatamente uma página.
        comConsentimento('granted');

        trackPageView('/pricing');

        expect(gtag).toHaveBeenCalledWith('event', 'page_view', { page_path: '/pricing' });
    });
});

describe('Origem do visitante', () => {
    it('guarda a campanha da URL', () => {
        naPagina('https://verticeinvest.com.br/pricing?utm_source=youtube&utm_medium=video&utm_campaign=agosto');

        const origem = captureAcquisition();

        expect(origem).toMatchObject({
            source: 'youtube',
            medium: 'video',
            campaign: 'agosto',
            landingPath: '/pricing',
        });
    });

    it('guarda quem indicou quando não há campanha', () => {
        naPagina('https://verticeinvest.com.br/', 'https://www.google.com/search?q=vertice');

        expect(captureAcquisition()?.referrer).toContain('google.com');
    });

    it('ignora navegação interna como origem', () => {
        // Sair da landing para /pricing não é uma origem nova.
        naPagina('https://verticeinvest.com.br/pricing', 'https://verticeinvest.com.br/');

        expect(captureAcquisition()).toBeNull();
    });

    it('não grava nada na visita direta', () => {
        // Ausência de marcação É a informação: o servidor agrupa como "direto".
        naPagina('https://verticeinvest.com.br/');

        expect(captureAcquisition()).toBeNull();
        expect(readAcquisition()).toBeNull();
    });

    it('mantém o PRIMEIRO toque quando o visitante navega', () => {
        naPagina('https://verticeinvest.com.br/?utm_source=youtube');
        captureAcquisition();

        naPagina('https://verticeinvest.com.br/pricing?utm_source=interno');
        captureAcquisition();

        expect(readAcquisition()?.source).toBe('youtube');
    });

    it('esquece a origem depois do cadastro', () => {
        // A partir do cadastro ela é atributo da conta no servidor; manter a
        // cópia no navegador criaria uma segunda verdade.
        naPagina('https://verticeinvest.com.br/?utm_source=youtube');
        captureAcquisition();

        clearAcquisition();

        expect(readAcquisition()).toBeNull();
    });

    it('não depende de consentimento de cookie', () => {
        // É dado do cadastro, primeira parte, guardado só na sessão — não é o
        // cookie de medição do Google, que exige permissão.
        comConsentimento('denied');
        naPagina('https://verticeinvest.com.br/?utm_source=youtube');

        expect(captureAcquisition()?.source).toBe('youtube');
    });

    it('sobrevive a storage bloqueado', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
        naPagina('https://verticeinvest.com.br/?utm_source=youtube');

        expect(() => captureAcquisition()).not.toThrow();
        vi.restoreAllMocks();
    });
});
