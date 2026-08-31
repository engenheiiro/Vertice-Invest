/**
 * Consentimento de medição de uso (LGPD Art. 7º, I).
 *
 * O Google Analytics carregava incondicionalmente no `index.html`, antes de
 * qualquer aviso — enquanto a Política de Privacidade e o banner de cookies
 * afirmavam que não havia analytics de terceiros. Cookie de medição não é
 * "estritamente necessário", então a base legal só pode ser consentimento: ele
 * precisa vir ANTES da coleta, e não ser presumido por silêncio nem por um
 * "Entendi" num aviso que dizia outra coisa.
 *
 * Por isso a tag não mora mais no HTML. Ela é injetada aqui, e só depois de um
 * "Aceitar" explícito. Sem decisão registrada = nada carrega.
 */

export type ConsentChoice = 'granted' | 'denied';

/** Chave NOVA de propósito: o `vertice_cookie_notice_dismissed` antigo registrava
 *  ciência de "não usamos rastreamento". Reaproveitá-lo transformaria aquele
 *  aceite em consentimento para algo que o usuário nunca leu. Quem dispensou o
 *  aviso antigo é perguntado de novo. */
export const CONSENT_STORAGE_KEY = 'vertice_consent_analytics_v1';

/** Reabre o banner quando o usuário revoga pela Política de Privacidade. */
export const CONSENT_CHANGE_EVENT = 'vertice:consent-change';

const env = (import.meta as any).env;
export const GA_MEASUREMENT_ID: string = env?.VITE_GA_MEASUREMENT_ID || 'G-V9QW6ZJEQW';

const GA_SCRIPT_ID = 'ga4-consented';

/** Flag oficial de opt-out do GA: uma vez carregada, a tag continua na página
 *  até o próximo F5, e é isto que a faz parar de enviar hit. */
const gaDisableFlag = () => `ga-disable-${GA_MEASUREMENT_ID}`;

export const readConsent = (): ConsentChoice | null => {
    try {
        const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
        return stored === 'granted' || stored === 'denied' ? stored : null;
    } catch {
        // Modo privado / storage bloqueado: sem registro é como se nunca tivesse
        // decidido — perguntamos de novo em vez de assumir permissão.
        return null;
    }
};

export const hasDecidedConsent = () => readConsent() !== null;

/** Injeta o gtag. Idempotente: chamada repetida não duplica a tag. */
export const loadAnalytics = (): boolean => {
    if (typeof document === 'undefined') return false;
    (window as any)[gaDisableFlag()] = false;
    if (document.getElementById(GA_SCRIPT_ID)) return false;

    const tag = document.createElement('script');
    tag.id = GA_SCRIPT_ID;
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(tag);

    const w = window as any;
    w.dataLayer = w.dataLayer || [];
    // `arguments` (não rest) é exigência do gtag.js: ele identifica os comandos
    // pelo objeto `arguments` cru empilhado no dataLayer. Um array de rest params
    // é empilhado como dado comum e o comando nunca é executado — falha silenciosa.
    // eslint-disable-next-line prefer-rest-params
    w.gtag = function gtag() { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    // `send_page_view: false` porque quem conta página aqui é o FunnelTracker,
    // uma vez por rota. O padrão do GA4 é o `config` disparar um `page_view`
    // sozinho — e como numa SPA ele só dispararia no carregamento, o tracker
    // existe de qualquer jeito. Com os dois ligados, quem já tinha consentido
    // entrava com DUAS visualizações da página de entrada: páginas por sessão
    // inflada justo na população que estamos medindo.
    w.gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true, send_page_view: false });
    return true;
};

/** Apaga os cookies `_ga*` já gravados. Revogar precisa alcançar o que foi
 *  coletado sob o consentimento anterior, não só o envio futuro. */
const clearAnalyticsCookies = () => {
    if (typeof document === 'undefined') return;
    const nomes = document.cookie
        .split(';')
        .map((par) => par.split('=')[0].trim())
        .filter((nome) => nome.startsWith('_ga') || nome === '_gid');

    const expirado = 'Thu, 01 Jan 1970 00:00:00 GMT';
    const host = window.location.hostname;
    for (const nome of nomes) {
        document.cookie = `${nome}=; expires=${expirado}; path=/`;
        // O GA grava no domínio raiz com ponto — sem repetir com `domain` o
        // cookie sobrevive à remoção acima.
        document.cookie = `${nome}=; expires=${expirado}; path=/; domain=.${host}`;
    }
};

export const disableAnalytics = () => {
    (window as any)[gaDisableFlag()] = true;
    clearAnalyticsCookies();
};

const persist = (choice: ConsentChoice | null) => {
    try {
        if (choice === null) localStorage.removeItem(CONSENT_STORAGE_KEY);
        else localStorage.setItem(CONSENT_STORAGE_KEY, choice);
    } catch {
        // Sem storage a escolha vale só para esta sessão — aplicada em memória
        // logo abaixo. Melhor do que falhar e deixar a tag carregada.
    }
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: choice }));
};

export const grantAnalyticsConsent = () => {
    persist('granted');
    loadAnalytics();
};

export const denyAnalyticsConsent = () => {
    persist('denied');
    disableAnalytics();
};

/** Revogação (Art. 18, IX): volta ao estado "nunca perguntado" e para a coleta
 *  imediatamente — a permissão anterior não pode sobreviver ao clique. */
export const resetAnalyticsConsent = () => {
    persist(null);
    disableAnalytics();
};

/** Chamada uma vez no boot, antes do React montar. */
export const initAnalyticsConsent = () => {
    if (readConsent() === 'granted') loadAnalytics();
    else disableAnalytics();
};
