/**
 * Data de pagamento de provento — utils/dividendPaymentDate.js.
 *
 * Regressão do defeito de 09/09/2026: GGRC11 ficou ex em 02/09, PAGOU em 09/09 e a
 * carteira exibia "Agendado 16/09". A data nunca foi anunciada por ninguém — é a
 * estimativa ex+15 que o produto mostrava com cara de fato.
 *
 * Dois contratos travados aqui:
 *  1) A conta é UTC pura. O relatório de IR lia o dia em UTC e escrevia com setDate
 *     LOCAL: em processo BRT (UTC-3) a meia-noite UTC é 21h do dia anterior, então
 *     para ex-date no dia 1º o mês local ainda era o anterior e o pagamento voltava
 *     um MÊS. Com ex-date em 1º de janeiro, a renda ia para o ANO errado no informe.
 *  2) Estimativa se declara estimativa (`isEstimated`), para a tela não afirmar o
 *     que não sabe.
 */
import { describe, it, expect } from 'vitest';
import {
    ESTIMATED_PAYMENT_LAG_DAYS,
    estimatedPaymentDate,
    normalizeToUtcDay,
    resolvePaymentDate,
} from '../utils/dividendPaymentDate.js';

const iso = (d) => d.toISOString();

describe('estimativa de data de pagamento (ex-date + 15 dias)', () => {
    it('soma 15 dias corridos sobre a meia-noite UTC da ex-date', () => {
        expect(iso(estimatedPaymentDate(new Date('2026-09-02T00:00:00.000Z'))))
            .toBe('2026-09-17T00:00:00.000Z');
        expect(ESTIMATED_PAYMENT_LAG_DAYS).toBe(15);
    });

    it('ex-date no dia 1º NÃO retrocede de mês (defeito do informe de IR)', () => {
        // Com a conta antiga (getUTCDate + setDate local) isto devolvia 2026-05-17
        // num processo em BRT: um mês ATRÁS da ex-date.
        expect(iso(estimatedPaymentDate(new Date('2026-06-01T00:00:00.000Z'))))
            .toBe('2026-06-16T00:00:00.000Z');
    });

    it('ex-date em 1º de janeiro permanece no MESMO ano (renda no ano certo)', () => {
        const pay = estimatedPaymentDate(new Date('2027-01-01T00:00:00.000Z'));
        expect(iso(pay)).toBe('2027-01-16T00:00:00.000Z');
        expect(pay.getUTCFullYear()).toBe(2027);
    });

    it('atravessa a virada de mês e de ano pela contagem de dias, não pelo dia do mês', () => {
        expect(iso(estimatedPaymentDate(new Date('2026-12-28T00:00:00.000Z'))))
            .toBe('2027-01-12T00:00:00.000Z');
        expect(iso(estimatedPaymentDate(new Date('2028-02-20T00:00:00.000Z'))))
            .toBe('2028-03-06T00:00:00.000Z'); // 2028 é bissexto: 29/02 existe
    });

    it('independe da hora do evento — a ex-date é um dia, não um instante', () => {
        // A fonte devolve o mesmo provento ora 00:00Z, ora 13:00Z (ver dividendIdentity).
        const meiaNoite = estimatedPaymentDate(new Date('2026-09-02T00:00:00.000Z'));
        const tarde = estimatedPaymentDate(new Date('2026-09-02T13:45:00.000Z'));
        expect(iso(tarde)).toBe(iso(meiaNoite));
    });

    it('normalizeToUtcDay zera a hora sem deslocar o dia', () => {
        expect(iso(normalizeToUtcDay(new Date('2026-09-02T23:59:59.999Z'))))
            .toBe('2026-09-02T00:00:00.000Z');
    });
});

describe('resolvePaymentDate — oficial x estimada', () => {
    it('usa a data oficial quando a fonte publica e NÃO a marca como estimativa', () => {
        const { date, isEstimated } = resolvePaymentDate({
            date: new Date('2026-09-02T00:00:00.000Z'),
            paymentDate: new Date('2026-09-09T00:00:00.000Z'),
        });
        expect(iso(date)).toBe('2026-09-09T00:00:00.000Z');
        expect(isEstimated).toBe(false);
    });

    it('cai na estimativa e SE DECLARA estimativa quando falta paymentDate', () => {
        // O caso real do GGRC11: pago em 09/09, estimado em 17/09 (exibido 16/09 em BRT).
        const { date, isEstimated } = resolvePaymentDate({ date: new Date('2026-09-02T00:00:00.000Z') });
        expect(iso(date)).toBe('2026-09-17T00:00:00.000Z');
        expect(isEstimated).toBe(true);
    });

    it('trata paymentDate null/ausente igual (82% dos eventos do banco)', () => {
        expect(resolvePaymentDate({ date: '2026-09-02', paymentDate: null }).isEstimated).toBe(true);
        expect(resolvePaymentDate({ date: '2026-09-02' }).isEstimated).toBe(true);
    });

    it('aceita chave de dia (YYYY-MM-DD) além de Date — mesmo resultado', () => {
        expect(iso(resolvePaymentDate({ date: '2026-09-02' }).date))
            .toBe(iso(resolvePaymentDate({ date: new Date('2026-09-02T00:00:00.000Z') }).date));
    });
});
