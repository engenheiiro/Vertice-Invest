/**
 * Origem da conta — saneamento da entrada do cliente.
 *
 * Este é o único campo do funil escrito pelo navegador, e ele é persistido,
 * agregado e exibido no painel admin. Um link montado de propósito
 * (`?utm_source=` com o que der na telha) não pode virar documento aberto no
 * banco, linha de log forjada nem query string de terceiro guardada para sempre.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeAcquisition } from '../utils/acquisition.js';

describe('Campos aceitos', () => {
    it('normaliza origem e meio para minúsculas', () => {
        const limpo = sanitizeAcquisition({ source: '  YouTube ', medium: 'Organico' });

        expect(limpo.source).toBe('youtube');
        expect(limpo.medium).toBe('organico');
        expect(limpo.capturedAt).toBeInstanceOf(Date);
    });

    it('guarda só o host de quem indicou', () => {
        // A URL inteira traz caminho e query de outro site: nada disso nos diz de
        // onde veio o cadastro, e pode carregar dado de terceiro.
        const limpo = sanitizeAcquisition({ referrer: 'https://www.youtube.com/watch?v=abc123&t=42' });

        expect(limpo.referrerHost).toBe('www.youtube.com');
        expect(JSON.stringify(limpo)).not.toContain('abc123');
    });

    it('grava a página de entrada sem query string', () => {
        // `?token=`, `?email=` e afins circulam em link de divulgação; guardá-los
        // num campo de marketing é vazamento com prazo indeterminado.
        const limpo = sanitizeAcquisition({ landingPath: '/pricing?token=segredo#plano' });

        expect(limpo.landingPath).toBe('/pricing');
    });
});

describe('Entrada hostil', () => {
    it('remove quebra de linha — linha de log forjada', () => {
        const limpo = sanitizeAcquisition({ source: 'you\ntube\r\nADMIN_LOGIN' });

        expect(limpo.source).not.toMatch(/[\r\n]/);
    });

    it('remove sinais de marcação', () => {
        const limpo = sanitizeAcquisition({ campaign: '<img src=x onerror=alert(1)>' });

        expect(limpo.campaign).not.toContain('<');
        expect(limpo.campaign).not.toContain('>');
    });

    it('corta valor absurdamente longo', () => {
        const limpo = sanitizeAcquisition({ source: 'a'.repeat(5000) });

        expect(limpo.source.length).toBeLessThanOrEqual(80);
    });

    it('descarta campo que não está na lista', () => {
        // Objeto aberto viraria documento arbitrário dentro do User.
        const limpo = sanitizeAcquisition({ source: 'youtube', role: 'ADMIN', plan: 'BLACK' });

        expect(limpo).toEqual({ source: 'youtube', capturedAt: expect.any(Date) });
    });

    it('ignora caminho de entrada que não seja caminho', () => {
        expect(sanitizeAcquisition({ landingPath: 'https://site-falso.com/pricing' })).toBeUndefined();
    });
});

describe('Ausência', () => {
    it('devolve undefined quando não sobra nada aproveitável', () => {
        // Campo ausente é mais honesto que um objeto vazio em toda conta.
        expect(sanitizeAcquisition(undefined)).toBeUndefined();
        expect(sanitizeAcquisition({})).toBeUndefined();
        expect(sanitizeAcquisition({ source: '   ' })).toBeUndefined();
    });

    it('recusa entrada que não é objeto', () => {
        expect(sanitizeAcquisition('youtube')).toBeUndefined();
        expect(sanitizeAcquisition(['youtube'])).toBeUndefined();
    });
});
