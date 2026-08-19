import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Utilitários de quem SERVE o shell buildado (client/dist) — a CSP dos scripts
 * inline do próprio app e a fronteira entre "arquivo estático" e "rota da SPA".
 */

/** Hash CSP (sha256/base64) do conteúdo EXATO de um script inline. */
export const inlineScriptHash = (code) =>
    `'sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}'`;

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
// Só estes tipos EXECUTAM. `application/ld+json`, `importmap` e afins são dado,
// não script: pedir hash para eles só engordaria a política.
const EXECUTABLE_TYPES = new Set(['module', 'text/javascript', 'application/javascript']);

/**
 * Hashes CSP de todo script inline executável de um HTML. Script com `src` fica
 * de fora de propósito: esse é autorizado pela ORIGEM, não pelo conteúdo.
 */
export const extractInlineScriptHashes = (html) => {
    const hashes = [];
    for (const [, attrs, code] of String(html || '').matchAll(SCRIPT_TAG)) {
        if (/\bsrc\s*=/i.test(attrs)) continue;
        const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1]?.toLowerCase();
        if (type && !EXECUTABLE_TYPES.has(type)) continue;
        if (!code.trim()) continue;
        hashes.push(inlineScriptHash(code));
    }
    return [...new Set(hashes)];
};

/**
 * Hashes de TODOS os HTML do build (o prerender emite um por rota, e o shell
 * inline se repete em todos).
 *
 * Derivar do artefato, e não de uma constante escrita à mão, é o ponto: hash
 * fixo apodrece em silêncio — basta alguém editar o script inline para o
 * navegador passar a bloquear, sem nenhum teste quebrar. Ler falha? Devolve o
 * que já tem: CSP incompleta degrada função (analytics, anti-FOUC), CSP que
 * impede o servidor de subir derruba o produto.
 */
export const collectShellScriptHashes = (distPath, { maxDepth = 3 } = {}) => {
    const hashes = new Set();
    const walk = (dir, depth) => {
        if (depth > maxDepth) return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'assets') walk(full, depth + 1); // /assets só tem binário fingerprintado
            } else if (entry.name.endsWith('.html')) {
                try {
                    extractInlineScriptHashes(fs.readFileSync(full, 'utf8')).forEach((h) => hashes.add(h));
                } catch {
                    // arquivo ilegível não pode derrubar o boot
                }
            }
        }
    };
    walk(distPath, 0);
    return [...hashes];
};

// Extensões que o build publica como ARQUIVO. Decidir por extensão conhecida, e
// não por "o caminho tem ponto", porque deep link de SPA pode ter ponto
// legítimo (ticker 'BRK.B') e devolver 404 nele derrubaria a navegação.
const STATIC_EXTENSIONS = new Set([
    'js', 'mjs', 'css', 'map', 'json', 'webmanifest', 'wasm',
    'ico', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'txt', 'xml', 'mp4', 'webm', 'pdf',
]);

/**
 * O caminho pede um ARQUIVO do build (e não uma rota da SPA)? Usado pelo
 * fallback: arquivo que não existe merece 404, nunca o index.html.
 */
export const isStaticAssetPath = (urlPath) => {
    const p = String(urlPath || '');
    if (p.startsWith('/assets/')) return true;
    const dot = p.lastIndexOf('.');
    if (dot < 0) return false;
    return STATIC_EXTENSIONS.has(p.slice(dot + 1).toLowerCase());
};
