import { describe, expect, it } from 'vitest';

import { PLAN_CATALOG } from '../config/subscription.js';
import { featuresFor, planLabelFor } from '../services/emailService.js';

/**
 * O catálogo dentro do e-mail.
 *
 * Este arquivo existe por causa de um defeito real: os e-mails de cobrança
 * ficaram com a tabela de preços antiga depois que o plano comercial mudou, e
 * quem pagava R$ 129,90 pelo Elite recebia um recibo dizendo "R$ 120,00/mês".
 * Nada quebrava — e-mail não tem tela que alguém confira — então a divergência
 * só apareceria numa reclamação.
 *
 * O que se protege aqui:
 *  - preço do e-mail é o preço que o checkout cobra (mesma tabela, não uma cópia);
 *  - o anual não é anunciado como mensalidade;
 *  - promessa aposentada não volta pelo recibo, que é onde ela custa mais caro.
 */

/** Formatação independente da do código: "29.9" → "29,90". Se os dois lados
 *  usassem o mesmo Intl, o teste concordaria consigo mesmo e não com o preço. */
const comoNoRecibo = (valor) => valor.toFixed(2).replace('.', ',');

const PAGOS = Object.keys(PLAN_CATALOG);

describe('Rótulo do plano', () => {
    it.each(PAGOS)('%s anuncia o preço mensal que o checkout cobra', (plano) => {
        expect(planLabelFor(plano)).toContain(comoNoRecibo(PLAN_CATALOG[plano].monthly));
    });

    it.each(PAGOS)('%s traz o nome do plano, não só a chave', (plano) => {
        expect(planLabelFor(plano)).toContain(PLAN_CATALOG[plano].title);
    });

    it('no anual, cobra de uma vez e diz isso', () => {
        // R$ 598,80 é o total dos 12 meses. Chamar isso de "/mês" seria anunciar
        // uma mensalidade de quase 600 reais logo depois da compra.
        const rotulo = planLabelFor('PRO', 'ANNUAL');

        expect(rotulo).toContain(comoNoRecibo(PLAN_CATALOG.PRO.annual));
        expect(rotulo).toContain('12 meses');
        expect(rotulo).not.toContain('/mês');
    });

    it('plano sem anual cai no mensal em vez de inventar um valor', () => {
        // O BLACK nunca teve ciclo anual (saiu da venda antes disso).
        expect(planLabelFor('BLACK', 'ANNUAL')).toContain(comoNoRecibo(PLAN_CATALOG.BLACK.monthly));
    });

    it('entende a chave de checkout, não só o plano base', () => {
        expect(planLabelFor('PRO_ANNUAL', 'ANNUAL')).toBe(planLabelFor('PRO', 'ANNUAL'));
        expect(planLabelFor('PRO_TEST')).toBe(planLabelFor('PRO'));
    });

    it('não quebra com plano desconhecido', () => {
        expect(planLabelFor('PLANO_QUE_NAO_EXISTE')).toBe('PLANO_QUE_NAO_EXISTE');
        expect(planLabelFor(undefined)).toBe('');
    });
});

describe('Lista de benefícios', () => {
    it.each(PAGOS)('%s lista algo que o assinante realmente recebe', (plano) => {
        expect(featuresFor(plano).length).toBeGreaterThan(0);
    });

    it('não ressuscita as promessas que saíram da vitrine', () => {
        // Concierge, carteira private e gestão tributária foram retirados por não
        // existirem; o suporte 24h segue sem canal publicado. Um recibo que os
        // anuncie é pior que um card: chega depois do pagamento.
        const proibido = /concierge|private|gest[aã]o tribut|24h|24 horas/i;

        for (const plano of PAGOS) {
            for (const beneficio of featuresFor(plano)) {
                expect(beneficio, `${plano}: "${beneficio}" é promessa sem entrega`).not.toMatch(proibido);
            }
        }
    });

    it('o anual recebe os mesmos benefícios do plano base', () => {
        expect(featuresFor('ELITE_ANNUAL')).toEqual(featuresFor('ELITE'));
    });

    it('plano desconhecido devolve lista vazia, não erro', () => {
        expect(featuresFor('NADA')).toEqual([]);
    });
});
