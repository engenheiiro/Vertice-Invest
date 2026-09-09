/**
 * Convenção ÚNICA de DATA DE PAGAMENTO de provento.
 *
 * Nossa fonte de proventos (Yahoo, via externalMarketService.getDividendsHistory)
 * publica apenas a EX-DATE — a data que decide QUEM recebe. A data de pagamento
 * (QUANDO cai na conta) vem vazia em 82% dos eventos do banco. Todo caminho que
 * precisa dela ESTIMA: ex-date + 15 dias corridos.
 *
 * Duas regras que este módulo existe para travar:
 *
 * 1) A conta é em UTC puro. As ex-dates ficam à meia-noite UTC e, num processo em
 *    BRT (UTC-3), isso é 21h do dia ANTERIOR. O relatório de IR lia o dia em UTC e
 *    escrevia com `setDate` (LOCAL): para ex-date no dia 1º o mês local ainda era o
 *    anterior e o pagamento voltava um MÊS (2027-01-01 → 2026-12-17). Como o informe
 *    de rendimentos filtra por ANO, um FII que fica ex em 1º de janeiro teria sua
 *    renda declarada no ano anterior. Somar milissegundos sobre a meia-noite UTC dá
 *    o mesmo resultado no dev (BRT) e em produção (UTC).
 *
 * 2) Estimativa é chute, não dado. `resolvePaymentDate` devolve `isEstimated` junto
 *    com a data justamente para que a UI marque o chute como chute — exibir ex+15
 *    com cara de data anunciada fazia o usuário concluir que o sistema errou quando
 *    o dinheiro caía antes (caso real: GGRC11 ficou ex em 02/09/2026, pagou em 09/09
 *    e a carteira exibia "Agendado 16/09").
 *
 * Enquanto não houver fonte real de data de pagamento, esta é a régua — uma só.
 */

export const ESTIMATED_PAYMENT_LAG_DAYS = 15;

const DAY_MS = 86400000;

// Meia-noite UTC do dia da data informada (dia puro, sem hora e sem fuso).
export const normalizeToUtcDay = (date) => {
    const d = new Date(date);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

// Estimativa: ex-date + 15 dias corridos, em aritmética UTC.
export const estimatedPaymentDate = (exDate) =>
    new Date(normalizeToUtcDay(exDate).getTime() + ESTIMATED_PAYMENT_LAG_DAYS * DAY_MS);

/**
 * Data de pagamento de um evento de provento.
 * @param {{date: Date|string, paymentDate?: Date|string|null}} event
 * @returns {{date: Date, isEstimated: boolean}} oficial quando a fonte publica;
 *          senão a estimativa, marcada como tal.
 */
export const resolvePaymentDate = (event) => {
    const official = event?.paymentDate ? normalizeToUtcDay(event.paymentDate) : null;
    return {
        date: official || estimatedPaymentDate(event?.date),
        isEstimated: !official,
    };
};
