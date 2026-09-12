/**
 * Contexto técnico anexado ao ticket.
 *
 * Serve a uma pergunta só: em que condições o problema aconteceu? Quase todo
 * relato chega como "não está funcionando", e sem rota, navegador e o último
 * erro de rede a resposta vira uma entrevista de três mensagens.
 *
 * Nada disso aparece para o usuário — o servidor remove o campo antes de
 * devolver o ticket a ele. O que é coletado está declarado na Política de
 * Privacidade.
 */

export interface ApiErrorEntry {
    at: string;
    status: number;
    path: string;
    message?: string;
}

export interface SupportContext {
    route: string;
    userAgent: string;
    platform: string;
    viewport: string;
    timezone: string;
    appVersion: string;
    recentErrors: ApiErrorEntry[];
}

// Buffer em memória das últimas falhas de API da sessão. Memória, e não
// localStorage, de propósito: é diagnóstico do "agora", e erro de ontem
// guardado no disco só confunde quem lê o ticket.
const MAX_ERRORS = 3;
let recentErrors: ApiErrorEntry[] = [];

/**
 * Registra uma falha de API. Chamado pelo `authService.api`, que é o funil
 * único de rede do app.
 */
export function recordApiError(path: string, status: number, message?: string): void {
    // O caminho pode carregar query string com token de compartilhamento; só o
    // path interessa, e é o que não vaza segredo para dentro do ticket.
    const cleanPath = String(path).split('?')[0];

    recentErrors = [
        { at: new Date().toISOString(), status, path: cleanPath, message },
        ...recentErrors,
    ].slice(0, MAX_ERRORS);
}

export function getRecentApiErrors(): ApiErrorEntry[] {
    return recentErrors;
}

export function collectSupportContext(): SupportContext {
    return {
        route: window.location.pathname,
        userAgent: navigator.userAgent,
        platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
            || navigator.platform
            || '',
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        // String(): o tipo de `import.meta.env` admite boolean (MODE/DEV/PROD),
        // e a versão é sempre texto no ticket.
        appVersion: String(import.meta.env.VITE_APP_VERSION ?? 'dev'),
        recentErrors: getRecentApiErrors(),
    };
}
