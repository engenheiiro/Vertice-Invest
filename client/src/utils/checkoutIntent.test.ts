import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCheckoutIntent, readCheckoutIntent, saveCheckoutIntent } from './checkoutIntent';

/**
 * A escolha de plano atravessando o cadastro.
 *
 * O caminho tem três saltos (vitrine → cadastro → login → vitrine) e o que
 * viaja é uma chave que vai indexar tabela de preço e virar chave de checkout.
 * Por isso a leitura é fechada: storage é escrito pelo navegador, e um plano
 * aposentado deixado ali não pode reviver por um caminho lateral.
 */

beforeEach(() => {
    sessionStorage.clear();
});

describe('Ida e volta', () => {
    it('guarda plano e ciclo escolhidos antes do cadastro', () => {
        saveCheckoutIntent({ plan: 'PRO', cycle: 'ANNUAL' });

        expect(readCheckoutIntent()).toEqual({ plan: 'PRO', cycle: 'ANNUAL' });
    });

    it('some quando a intenção é consumida', () => {
        saveCheckoutIntent({ plan: 'ELITE', cycle: 'MONTHLY' });

        clearCheckoutIntent();

        expect(readCheckoutIntent()).toBeNull();
    });

    it('não inventa intenção onde não houve escolha', () => {
        expect(readCheckoutIntent()).toBeNull();
    });
});

describe('Leitura fechada', () => {
    it('descarta plano fora da lista de venda', () => {
        // BLACK saiu do catálogo: aceitar de volta pelo storage o ressuscitaria
        // num caminho que ninguém revisa.
        sessionStorage.setItem('vertice_checkout_intent', JSON.stringify({ plan: 'BLACK', cycle: 'MONTHLY' }));

        expect(readCheckoutIntent()).toBeNull();
    });

    it('descarta plano que não existe', () => {
        sessionStorage.setItem('vertice_checkout_intent', JSON.stringify({ plan: 'PRO_MAX', cycle: 'MONTHLY' }));

        expect(readCheckoutIntent()).toBeNull();
    });

    it('descarta ciclo inválido em vez de assumir mensal', () => {
        // Assumir um ciclo cobraria um valor que o usuário não escolheu.
        sessionStorage.setItem('vertice_checkout_intent', JSON.stringify({ plan: 'PRO', cycle: 'SEMESTRAL' }));

        expect(readCheckoutIntent()).toBeNull();
    });

    it('sobrevive a conteúdo corrompido', () => {
        sessionStorage.setItem('vertice_checkout_intent', 'não é json');

        expect(() => readCheckoutIntent()).not.toThrow();
        expect(readCheckoutIntent()).toBeNull();
    });

    it('recusa gravar plano que não está à venda', () => {
        saveCheckoutIntent({ plan: 'GUEST', cycle: 'MONTHLY' });

        expect(readCheckoutIntent()).toBeNull();
    });
});

describe('Storage indisponível', () => {
    it('não trava o cadastro quando não dá para gravar', () => {
        // Perder a comodidade é aceitável; impedir a criação da conta não é.
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });

        expect(() => saveCheckoutIntent({ plan: 'PRO', cycle: 'ANNUAL' })).not.toThrow();

        vi.restoreAllMocks();
    });
});
