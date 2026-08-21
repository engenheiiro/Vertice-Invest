/**
 * Regressão da política de CORS.
 *
 * O defeito original: origem fora da allowlist virava `new Error` → 500 do
 * errorHandler. Como script de módulo (`crossorigin`) e POST mandam `Origin`
 * até na mesma origem, o app quebrava inteiro em qualquer endereço que não fosse
 * o `CLIENT_URL` literal, e o painel de Saúde registrava tudo como erro interno.
 */
import { describe, expect, it } from 'vitest';
import {
    buildAllowedOrigins,
    hostVariants,
    normalizeOrigin,
    resolveCorsOrigin,
    sanitizeOriginForLog,
} from '../utils/corsOrigins.js';

const prodEnv = {
    NODE_ENV: 'production',
    CLIENT_URL: 'https://verticeinvest.com.br',
    API_URL: 'https://vertice.onrender.com',
};

const decide = (origin, extra = {}) => resolveCorsOrigin({
    origin,
    allowed: buildAllowedOrigins(prodEnv),
    isProduction: true,
    ...extra,
});

describe('normalizeOrigin', () => {
    it('normaliza caixa, barra final e porta default', () => {
        expect(normalizeOrigin('HTTPS://VerticeInvest.com.br/')).toBe('https://verticeinvest.com.br');
        expect(normalizeOrigin('https://verticeinvest.com.br:443')).toBe('https://verticeinvest.com.br');
    });

    it('recusa o que não é origem HTTP(S)', () => {
        for (const bad of ['', '   ', 'null', 'file:///etc/passwd', 'javascript:alert(1)', 'nao-e-url', undefined]) {
            expect(normalizeOrigin(bad)).toBeNull();
        }
    });
});

describe('allowlist', () => {
    it('aceita o par apex⇄www do CLIENT_URL', () => {
        expect(decide('https://verticeinvest.com.br').allowed).toBe(true);
        expect(decide('https://www.verticeinvest.com.br').allowed).toBe(true);
    });

    it('não inventa variante www para host que não é o do cliente', () => {
        const allowed = buildAllowedOrigins(prodEnv);
        expect(allowed.has('https://vertice.onrender.com')).toBe(true);
        expect(allowed.has('https://www.vertice.onrender.com')).toBe(false);
    });

    it('não cria variante para localhost nem para IP', () => {
        expect(hostVariants('http://localhost:5173')).toEqual(['http://localhost:5173']);
        expect(hostVariants('http://127.0.0.1:5000')).toEqual(['http://127.0.0.1:5000']);
    });

    it('aceita origem extra configurada sem deploy', () => {
        const allowed = buildAllowedOrigins({ ...prodEnv, CORS_EXTRA_ORIGINS: 'https://staging.vertice.app, https://preview.vertice.app' });
        expect(allowed.has('https://staging.vertice.app')).toBe(true);
        expect(allowed.has('https://preview.vertice.app')).toBe(true);
    });

    it('não libera localhost em produção', () => {
        expect(buildAllowedOrigins(prodEnv).has('http://localhost:5173')).toBe(false);
        expect(decide('http://localhost:5173').allowed).toBe(false);
    });
});

describe('decisão por requisição', () => {
    it('deixa passar requisição sem Origin (curl, webhook, health check)', () => {
        expect(decide(undefined).allowed).toBe(true);
        expect(decide('').allowed).toBe(true);
    });

    it('aceita a própria origem servida, mesmo fora da allowlist', () => {
        // É o caso do bundle do Vite: `<script type="module" crossorigin>` manda
        // Origin igual ao host que serviu a página. Barrar aqui = tela branca.
        const decision = decide('https://vertice-invest.onrender.com', {
            selfOrigin: 'https://vertice-invest.onrender.com',
        });
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toBe('mesma-origem');
    });

    it('bloqueia origem de terceiro', () => {
        expect(decide('https://evil.com').allowed).toBe(false);
        expect(decide('https://verticeinvest.com.br.evil.com').allowed).toBe(false);
        expect(decide('http://verticeinvest.com.br').allowed).toBe(false);
    });

    it('bloqueia Origin malformada em vez de deixar passar', () => {
        expect(decide('null').allowed).toBe(false);
        expect(decide('nao-e-url').allowed).toBe(false);
    });

    it('em dev libera qualquer porta local (preview, dist servido pelo Express)', () => {
        const devAllowed = buildAllowedOrigins({ NODE_ENV: 'development', CLIENT_URL: prodEnv.CLIENT_URL });
        const dev = (origin) => resolveCorsOrigin({ origin, allowed: devAllowed, isProduction: false });
        expect(dev('http://localhost:5000').allowed).toBe(true);
        expect(dev('http://localhost:4173').allowed).toBe(true);
        expect(dev('http://127.0.0.1:5173').allowed).toBe(true);
        expect(dev('https://evil.com').allowed).toBe(false);
    });
});

describe('sanitizeOriginForLog', () => {
    it('remove quebra de linha e espaço (forja de linha de log)', () => {
        const dirty = 'https://ok.com\n2026-01-01 [ERROR] linha forjada';
        expect(sanitizeOriginForLog(dirty)).toBe('https://ok.com2026-01-01[ERROR]linhaforjada');
        expect(sanitizeOriginForLog(dirty)).not.toContain('\n');
    });

    it('trunca origem gigante e nunca devolve vazio', () => {
        expect(sanitizeOriginForLog(`https://${'a'.repeat(500)}.com`)).toHaveLength(120);
        expect(sanitizeOriginForLog(undefined)).toBe('(vazia)');
    });
});
