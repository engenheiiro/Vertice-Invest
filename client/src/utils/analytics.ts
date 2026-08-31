/**
 * Medição do funil — as duas metades.
 *
 * O Google Analytics só enxerga quem aceitou o cookie de medição, então ele
 * responde bem a uma pergunta só: **de onde vem a visita**. Quantas contas
 * viraram assinatura sai do nosso próprio banco (server/services/funnelService),
 * onde todo mundo aparece porque é registro do serviço, não medição opcional.
 *
 * Aqui ficam as duas pontas do lado do navegador:
 *  1. eventos para o GA, que NÃO saem sem consentimento (falha em silêncio);
 *  2. a origem do primeiro toque, guardada na sessão e enviada uma única vez,
 *     no cadastro, para virar atributo da conta.
 */

import { readConsent } from './analyticsConsent';

/** Só a sessão da aba: a origem existe para acompanhar quem vai criar conta
 *  agora, não para ficar guardada no navegador de quem só passou pelo site. */
const ACQUISITION_KEY = 'vertice_acquisition';

export type Acquisition = {
    source?: string;
    medium?: string;
    campaign?: string;
    referrer?: string;
    landingPath?: string;
};

/** Empurra um evento ao GA. Sem permissão não faz nada — e não é erro: é o
 *  estado esperado de quem recusou. */
export const trackEvent = (name: string, params: Record<string, unknown> = {}) => {
    if (readConsent() !== 'granted') return false;
    const gtag = (window as any).gtag;
    if (typeof gtag !== 'function') return false;
    gtag('event', name, params);
    return true;
};

/** Página vista numa SPA: o `config` do gtag só dispara no carregamento inicial,
 *  então navegar entre rotas passaria despercebido. */
export const trackPageView = (path: string) => trackEvent('page_view', { page_path: path });

const primeiroValor = (params: URLSearchParams, ...chaves: string[]) => {
    for (const chave of chaves) {
        const valor = params.get(chave);
        if (valor && valor.trim()) return valor.trim();
    }
    return undefined;
};

/** Referenciador de fora do site. O interno é navegação nossa, não origem. */
const referenciadorExterno = (referrer: string, host: string) => {
    if (!referrer) return undefined;
    try {
        return new URL(referrer).hostname === host ? undefined : referrer;
    } catch {
        return undefined;
    }
};

/**
 * Captura a origem UMA vez por sessão — o primeiro toque é que conta.
 *
 * Sobrescrever a cada página daria o crédito ao último clique interno, e todo
 * cadastro apareceria como vindo de `/pricing`.
 */
export const captureAcquisition = (): Acquisition | null => {
    try {
        if (sessionStorage.getItem(ACQUISITION_KEY)) return readAcquisition();

        const params = new URLSearchParams(window.location.search);
        const capturado: Acquisition = {
            source: primeiroValor(params, 'utm_source', 'ref'),
            medium: primeiroValor(params, 'utm_medium'),
            campaign: primeiroValor(params, 'utm_campaign'),
            referrer: referenciadorExterno(document.referrer, window.location.hostname),
            landingPath: window.location.pathname,
        };

        // Sem origem nenhuma não vale gravar: a entrada direta é justamente a
        // ausência de marcação, e o servidor já agrupa isso como 'direto'.
        if (!capturado.source && !capturado.referrer) return null;

        sessionStorage.setItem(ACQUISITION_KEY, JSON.stringify(capturado));
        return capturado;
    } catch {
        // Storage bloqueado: seguimos sem atribuição em vez de quebrar a página.
        return null;
    }
};

export const readAcquisition = (): Acquisition | null => {
    try {
        const bruto = sessionStorage.getItem(ACQUISITION_KEY);
        return bruto ? (JSON.parse(bruto) as Acquisition) : null;
    } catch {
        return null;
    }
};

/** Depois do cadastro a origem já virou atributo da conta no servidor; manter
 *  a cópia no navegador só criaria uma segunda verdade. */
export const clearAcquisition = () => {
    try { sessionStorage.removeItem(ACQUISITION_KEY); } catch { /* nada a limpar */ }
};
