import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * O que os buscadores podem e não podem ver (Onda 5 do plano comercial).
 *
 * Estes dois arquivos decidem sozinhos se a página que vende existe para o
 * Google e se uma carteira compartilhada vira resultado de busca. Nenhum tipo,
 * build ou teste de componente encosta neles — uma linha a mais no robots.txt
 * apaga a vitrine do índice sem quebrar nada visível.
 *
 * Lidos como TEXTO, no mesmo espírito de subscription.test.ts: o teste falha na
 * divergência, não na configuração de build.
 */
const lerDaRaiz = (...caminhos: string[]) => {
    const encontrado = caminhos
        .flatMap((caminho) => [resolve(process.cwd(), caminho), resolve(process.cwd(), '..', caminho)])
        .find(existsSync);
    return readFileSync(String(encontrado), 'utf8');
};

const robots = lerDaRaiz('public/robots.txt', 'client/public/robots.txt');
const sitemap = lerDaRaiz('../server/routes/sitemapRouter.js', 'server/routes/sitemapRouter.js');

const bloqueadas = robots
    .split('\n')
    .filter((linha) => linha.trim().toLowerCase().startsWith('disallow:'))
    .map((linha) => linha.split(':')[1].trim());

const noSitemap = [...sitemap.matchAll(/url:\s*'([^']+)'/g)].map(([, url]) => url);

describe('robots.txt — o que o buscador pode visitar', () => {
    it('deixa a vitrine de planos passar', () => {
        // Ela ficou bloqueada enquanto o catálogo prometia o que não entregava.
        // Com preço, gates e anual no ar, esconder a página que vende é perda seca.
        expect(bloqueadas).not.toContain('/pricing');
    });

    it('bloqueia as carteiras compartilhadas por link', () => {
        // O token é secreto por design: quem compartilha manda para alguém, não
        // para o mundo. Indexar transformaria isso em resultado de busca.
        expect(bloqueadas).toContain('/p/');
    });

    it('mantém a área logada fora do índice', () => {
        for (const rota of ['/dashboard', '/wallet', '/profile', '/admin']) {
            expect(bloqueadas, `${rota} não pode ser rastreável`).toContain(rota);
        }
    });

    it('aponta para o sitemap', () => {
        expect(robots).toMatch(/^Sitemap:\s*https:\/\/\S+\/sitemap\.xml$/m);
    });
});

describe('sitemap — o que entregamos ao buscador', () => {
    it('inclui a página de planos', () => {
        expect(noSitemap).toContain('/pricing');
    });

    it('não anuncia nada que o robots.txt bloqueia', () => {
        // Sitemap e robots discordando é o pior dos dois mundos: pedimos que
        // rastreie e proibimos na mesma respiração.
        for (const url of noSitemap) {
            expect(bloqueadas, `${url} está no sitemap e bloqueado no robots`).not.toContain(url);
        }
    });

    it('não anuncia formulário de login ou cadastro', () => {
        // São formulário, não conteúdo — e já saem com noindex.
        expect(noSitemap).not.toContain('/login');
        expect(noSitemap).not.toContain('/register');
    });
});
