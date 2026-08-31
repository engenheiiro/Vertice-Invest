import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CONSENT_CHANGE_EVENT,
    CONSENT_STORAGE_KEY,
    GA_MEASUREMENT_ID,
    denyAnalyticsConsent,
    grantAnalyticsConsent,
    hasDecidedConsent,
    initAnalyticsConsent,
    loadAnalytics,
    readConsent,
    resetAnalyticsConsent,
} from './analyticsConsent';

/**
 * Consentimento de medição (Onda 5).
 *
 * O erro que estes testes impedem de voltar é específico: a tag do GA carregava
 * no HTML, antes de qualquer aviso, enquanto a Política afirmava que não havia
 * analytics. Nada disso quebrava um build — só a lei.
 */

const tagsDoGa = () =>
    Array.from(document.querySelectorAll('script')).filter((s) => s.src.includes('googletagmanager'));

const flagOptOut = () => (window as any)[`ga-disable-${GA_MEASUREMENT_ID}`];

beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    delete (window as any).dataLayer;
    delete (window as any).gtag;
    delete (window as any)[`ga-disable-${GA_MEASUREMENT_ID}`];
});

describe('Estado inicial — sem decisão registrada', () => {
    it('não carrega o Google Analytics', () => {
        initAnalyticsConsent();

        expect(tagsDoGa()).toHaveLength(0);
        expect(readConsent()).toBeNull();
        expect(hasDecidedConsent()).toBe(false);
    });

    it('ignora o aceite do aviso antigo', () => {
        // O "Entendi" antigo confirmava ciência de "não usamos rastreamento".
        // Tratá-lo como permissão seria consentir por alguém que leu o oposto.
        localStorage.setItem('vertice_cookie_notice_dismissed', '1');

        initAnalyticsConsent();

        expect(tagsDoGa()).toHaveLength(0);
        expect(hasDecidedConsent()).toBe(false);
    });

    it('trata storage indisponível como "ainda não perguntei"', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });

        expect(readConsent()).toBeNull();
        initAnalyticsConsent();
        expect(tagsDoGa()).toHaveLength(0);

        vi.restoreAllMocks();
    });
});

describe('Permissão concedida', () => {
    it('injeta a tag e configura o gtag', () => {
        grantAnalyticsConsent();

        expect(tagsDoGa()).toHaveLength(1);
        expect(tagsDoGa()[0].src).toContain(GA_MEASUREMENT_ID);
        expect(tagsDoGa()[0].async).toBe(true);
        expect((window as any).dataLayer.length).toBeGreaterThan(0);
    });

    it('persiste a escolha para o próximo carregamento', () => {
        grantAnalyticsConsent();
        document.head.innerHTML = '';

        initAnalyticsConsent();

        expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('granted');
        expect(tagsDoGa()).toHaveLength(1);
    });

    it('não duplica a tag se for chamada de novo', () => {
        loadAnalytics();
        loadAnalytics();

        expect(tagsDoGa()).toHaveLength(1);
    });

    it('deixa a contagem de página para o tracker, sem disparar a sua', () => {
        // O `config` do GA4 manda um page_view por padrão. Numa SPA ele só
        // dispararia no carregamento, então o FunnelTracker conta todas as rotas
        // — e com os dois ligados a página de entrada era contada duas vezes.
        grantAnalyticsConsent();

        const comandos = [...(window as any).dataLayer].map((args) => Array.from(args));
        const config = comandos.find(([comando]) => comando === 'config');

        expect(config, 'o gtag precisa ser configurado no carregamento').toBeDefined();
        expect(config?.[2]).toMatchObject({ send_page_view: false });
    });
});

describe('Permissão recusada', () => {
    it('não carrega nada e registra a recusa', () => {
        denyAnalyticsConsent();

        expect(tagsDoGa()).toHaveLength(0);
        expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('denied');
        // Uma recusa registrada é decisão: não perguntamos de novo a cada visita.
        expect(hasDecidedConsent()).toBe(true);
    });

    it('mantém a recusa depois de recarregar', () => {
        denyAnalyticsConsent();

        initAnalyticsConsent();

        expect(tagsDoGa()).toHaveLength(0);
        expect(flagOptOut()).toBe(true);
    });
});

describe('Revogação (Art. 18, IX)', () => {
    it('para a coleta na hora, mesmo com a tag já carregada', () => {
        grantAnalyticsConsent();
        expect(tagsDoGa()).toHaveLength(1);

        resetAnalyticsConsent();

        // A tag não some da página até o próximo F5 — o que a cala é a flag
        // oficial de opt-out do Google.
        expect(flagOptOut()).toBe(true);
        expect(readConsent()).toBeNull();
    });

    it('apaga os cookies _ga já gravados', () => {
        document.cookie = '_ga=GA1.1.123;path=/';
        document.cookie = '_ga_ABC=GS1.1.456;path=/';

        resetAnalyticsConsent();

        expect(document.cookie).not.toContain('_ga=');
        expect(document.cookie).not.toContain('_ga_ABC=');
    });

    it('avisa a interface para perguntar de novo', () => {
        const ouvinte = vi.fn();
        window.addEventListener(CONSENT_CHANGE_EVENT, ouvinte);

        resetAnalyticsConsent();

        expect(ouvinte).toHaveBeenCalled();
        expect((ouvinte.mock.calls[0][0] as CustomEvent).detail).toBeNull();
        window.removeEventListener(CONSENT_CHANGE_EVENT, ouvinte);
    });
});

describe('index.html — o portão que ninguém compila', () => {
    const html = (() => {
        const caminho = ['index.html', 'client/index.html']
            .map((p) => resolve(process.cwd(), p))
            .find(existsSync);
        return readFileSync(String(caminho), 'utf8');
    })();

    it('não carrega o Google Analytics antes do consentimento', () => {
        // Uma linha de <script> reintroduzida aqui derruba TODO o mecanismo
        // acima sem quebrar um teste sequer de comportamento.
        expect(html).not.toMatch(/<script[^>]+googletagmanager/i);
    });

    it('não deixa nenhum gtag solto no HTML', () => {
        expect(html).not.toMatch(/gtag\(\s*['"]config['"]/);
    });
});
