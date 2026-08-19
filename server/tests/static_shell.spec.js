import { describe, expect, it } from 'vitest';
import {
    collectShellScriptHashes,
    extractInlineScriptHashes,
    inlineScriptHash,
    isStaticAssetPath,
} from '../utils/staticShell.js';

describe('inlineScriptHash', () => {
    it('produz o hash sha256/base64 no formato que a CSP espera', () => {
        // Valor de referência calculado fora do código sob teste.
        expect(inlineScriptHash('alert(1)')).toBe("'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='");
    });

    it('um espaço a mais muda o hash — é por isso que ele é derivado do artefato, não fixado à mão', () => {
        expect(inlineScriptHash('alert(1)')).not.toBe(inlineScriptHash('alert(1) '));
    });
});

describe('extractInlineScriptHashes', () => {
    it('extrai o script inline executável', () => {
        const html = '<html><head><script>window.x=1;</script></head></html>';
        expect(extractInlineScriptHashes(html)).toEqual(["'sha256-g7sq2RbwbLEHSBobiM09D+ctI3iVsKqmfbqIiETF4t4='"]);
    });

    it('ignora script com src — esse é autorizado pela ORIGEM, não pelo conteúdo', () => {
        const html = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>';
        expect(extractInlineScriptHashes(html)).toEqual([]);
    });

    it('ignora bloco de DADO (ld+json não executa, não precisa de hash)', () => {
        const html = '<script type="application/ld+json">{"@type":"Organization"}</script>';
        expect(extractInlineScriptHashes(html)).toEqual([]);
    });

    it('aceita type=module e text/javascript', () => {
        const html = '<script type="module">a()</script><script type="text/javascript">b()</script>';
        expect(extractInlineScriptHashes(html)).toHaveLength(2);
    });

    it('ignora script vazio e não repete hash igual (o prerender emite o mesmo shell em vários HTML)', () => {
        const html = '<script></script><script>  </script><script>a()</script><script>a()</script>';
        expect(extractInlineScriptHashes(html)).toHaveLength(1);
    });

    it('pega os DOIS inline do shell real (anti-FOUC + GA4) numa tacada', () => {
        const html = `
            <script async src="https://www.googletagmanager.com/gtag/js?id=G-V9QW6ZJEQW"></script>
            <script>gtag('config', 'G-V9QW6ZJEQW');</script>
            <script>document.documentElement.setAttribute('data-theme', 'light');</script>
        `;
        expect(extractInlineScriptHashes(html)).toHaveLength(2);
    });

    it('entrada vazia/nula não quebra', () => {
        expect(extractInlineScriptHashes('')).toEqual([]);
        expect(extractInlineScriptHashes(null)).toEqual([]);
    });
});

describe('collectShellScriptHashes', () => {
    it('dist inexistente devolve lista vazia em vez de derrubar o boot', () => {
        expect(collectShellScriptHashes('/caminho/que/nao/existe')).toEqual([]);
    });
});

describe('isStaticAssetPath — fronteira entre arquivo do build e rota da SPA', () => {
    it('bundle com hash no nome é ARQUIVO (404 quando não existe, nunca o shell)', () => {
        expect(isStaticAssetPath('/assets/index-BF-eqTWs.js')).toBe(true);
        expect(isStaticAssetPath('/assets/index-Xfghehso.css')).toBe(true);
    });

    it('arquivos da raiz do build também', () => {
        expect(isStaticAssetPath('/sw.js')).toBe(true);
        expect(isStaticAssetPath('/manifest.webmanifest')).toBe(true);
        expect(isStaticAssetPath('/robots.txt')).toBe(true);
        expect(isStaticAssetPath('/og-image.png')).toBe(true);
    });

    it('rota da SPA NÃO é arquivo — inclusive deep link com ponto no meio', () => {
        expect(isStaticAssetPath('/login')).toBe(false);
        expect(isStaticAssetPath('/')).toBe(false);
        expect(isStaticAssetPath('/carteira/extrato')).toBe(false);
        // Ticker com ponto (classe B americana) não pode virar 404: quebraria a navegação.
        expect(isStaticAssetPath('/research/BRK.B')).toBe(false);
        expect(isStaticAssetPath('/pesquisa/PETR4.SA')).toBe(false);
    });

    it('extensão desconhecida não é tratada como arquivo (na dúvida, entrega a SPA)', () => {
        expect(isStaticAssetPath('/relatorio.qualquercoisa')).toBe(false);
    });

    it('entrada vazia/nula não quebra', () => {
        expect(isStaticAssetPath('')).toBe(false);
        expect(isStaticAssetPath(null)).toBe(false);
    });
});
