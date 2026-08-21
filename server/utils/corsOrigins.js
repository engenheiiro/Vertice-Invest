/**
 * Allowlist de CORS — decisão pura, testável fora do Express.
 *
 * O motivo de existir: a versão anterior comparava `req.headers.origin` com uma
 * lista de strings cruas (`CLIENT_URL` + localhost:5173) e, ao não achar,
 * lançava `new Error(...)` — que o errorHandler global transformava em **500**.
 * Duas consequências ruins:
 *
 *  1. Requisição de MESMA ORIGEM caía na regra. Script de módulo (`<script
 *     type="module" crossorigin>`, o que o Vite emite) e POST viajam em modo
 *     CORS e mandam `Origin` mesmo servidos pelo próprio host. Quem abrisse o
 *     app por um endereço que não fosse exatamente `CLIENT_URL` (www, o
 *     `*.onrender.com`, `localhost:5000` servindo o `dist`) recebia 500 no
 *     bundle — tela branca — e 500 no `/api/refresh` — sessão perdida.
 *  2. Origem estranha virava "erro interno" no painel de Saúde, sem registrar
 *     QUAL origem foi barrada. Ruído indiagnosticável.
 *
 * Aqui a origem é normalizada (`new URL().origin`: minúsculo, sem barra final,
 * sem porta default) e a allowlist ganha o par apex⇄www, porque o DNS aponta os
 * dois para o mesmo app.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/** `https://Site.com.br/` → `https://site.com.br`. Devolve null se não for origem HTTP(S) válida. */
export const normalizeOrigin = (value) => {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    // 'null' é o que o navegador manda de sandbox/data: — nunca é allowlistável.
    if (!raw || raw === 'null') return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.origin.toLowerCase();
    } catch {
        return null;
    }
};

/**
 * Par apex⇄www da mesma origem. Só para domínio de verdade: `localhost` e IP
 * não têm variante, e prefixar `www.` neles inventaria host inexistente.
 */
export const hostVariants = (origin) => {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return [];
    const url = new URL(normalized);
    const { hostname } = url;
    if (LOCAL_HOSTNAMES.has(hostname) || /^[\d.]+$/.test(hostname) || hostname.startsWith('[')) {
        return [normalized];
    }
    if (hostname.startsWith('www.')) {
        const apex = new URL(normalized);
        apex.hostname = hostname.slice(4);
        return [normalized, apex.origin.toLowerCase()];
    }
    if (hostname.split('.').length < 2) return [normalized];
    const www = new URL(normalized);
    www.hostname = `www.${hostname}`;
    return [normalized, www.origin.toLowerCase()];
};

/**
 * Monta a allowlist a partir do ambiente. `CORS_EXTRA_ORIGINS` (lista separada
 * por vírgula) existe para domínio novo/preview entrar sem deploy de código.
 *
 * O par apex⇄www só é derivado do `CLIENT_URL` — o domínio onde o usuário digita
 * o endereço. Para os demais (host interno do Render, extras) vale a origem
 * exata: inventar `www.` em domínio de terceiro alarga a allowlist de graça.
 */
export const buildAllowedOrigins = (env = process.env) => {
    const allowed = new Set();
    for (const variant of hostVariants(env.CLIENT_URL)) allowed.add(variant);
    const exact = [
        env.API_URL,
        env.RENDER_EXTERNAL_URL,
        ...String(env.CORS_EXTRA_ORIGINS || '').split(','),
    ];
    for (const candidate of exact) {
        const normalized = normalizeOrigin(candidate);
        if (normalized) allowed.add(normalized);
    }
    if (env.NODE_ENV !== 'production') allowed.add('http://localhost:5173');
    return allowed;
};

export const isLocalOrigin = (origin) => {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    try {
        return LOCAL_HOSTNAMES.has(new URL(normalized).hostname);
    } catch {
        return false;
    }
};

/**
 * Origem do cliente é entrada não confiável: pode conter quebra de linha (forja
 * linha de log) ou lixo. Mesma regra do access log — só o esqueleto de uma URL.
 */
export const sanitizeOriginForLog = (value) => String(value ?? '')
    .replace(/[^A-Za-z0-9.:/\-[\]]/g, '')
    .slice(0, 120) || '(vazia)';

/**
 * Decide o destino de uma requisição.
 *
 * `selfOrigin` é `protocolo://host` da própria requisição: se bate com a origem,
 * a página ESTÁ no mesmo host que a API — não existe cross-site a policiar, e o
 * navegador é quem garante isso (o `Host` de uma requisição é escolhido por ele,
 * não pela página atacante). É essa regra que impede o shell de quebrar em
 * qualquer domínio pelo qual o app seja legitimamente servido.
 */
export const resolveCorsOrigin = ({
    origin,
    selfOrigin = null,
    allowed = new Set(),
    isProduction = process.env.NODE_ENV === 'production',
} = {}) => {
    // Sem `Origin`: curl, servidor-a-servidor, navegação de documento. CORS não
    // se aplica — e barrar aqui derrubaria webhook e health check.
    if (origin === undefined || origin === null || origin === '') {
        return { allowed: true, reason: 'sem-origem' };
    }
    const normalized = normalizeOrigin(origin);
    if (!normalized) return { allowed: false, reason: 'origem-invalida' };
    if (allowed.has(normalized)) return { allowed: true, reason: 'allowlist' };
    if (selfOrigin && normalized === normalizeOrigin(selfOrigin)) {
        return { allowed: true, reason: 'mesma-origem' };
    }
    if (!isProduction && isLocalOrigin(normalized)) return { allowed: true, reason: 'dev-local' };
    return { allowed: false, reason: 'fora-da-allowlist' };
};
