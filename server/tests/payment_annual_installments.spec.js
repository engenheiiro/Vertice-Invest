/**
 * O que o Mercado Pago recebe em cada ciclo (server/services/paymentService.js).
 *
 * A regra do cartão é OPOSTA nos dois ciclos, e é fácil quebrar sem perceber:
 *  - mensal avulso EXCLUI o cartão (quem paga no cartão vira assinatura);
 *  - anual DEPENDE do cartão parcelado — é o que o card anuncia como "12×".
 *
 * O preço que viaja é o TOTAL do período. Mandar o equivalente mensal cobraria
 * R$49,90 por um ano de acesso.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.MP_ACCESS_TOKEN = 'APP_USR-teste';

const preferenceCreate = vi.fn().mockResolvedValue({ init_point: 'https://mp/pref', id: 'pref-1' });
const preApprovalCreate = vi.fn().mockResolvedValue({ init_point: 'https://mp/sub', id: 'preapp-1' });

vi.mock('mercadopago', () => ({
  MercadoPagoConfig: class { },
  Preference: class { create = preferenceCreate; },
  PreApproval: class { create = preApprovalCreate; },
}));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const { paymentService } = await import('../services/paymentService.js');
const { PLANS, ANNUAL_INSTALLMENTS } = await import('../config/subscription.js');

const user = { id: 'u1', name: 'Fulano', email: 'fulano@exemplo.com' };
const bodyOf = (mock) => mock.mock.calls.at(-1)[0].body;

beforeEach(() => vi.clearAllMocks());

describe('Checkout anual — cartão parcelado é a porta principal', () => {
  it('libera o cartão e permite até 12 parcelas', async () => {
    await paymentService.createOneTimeCheckout(user, 'PRO_ANNUAL');
    const { payment_methods: metodos } = bodyOf(preferenceCreate);

    expect(metodos.installments).toBe(ANNUAL_INSTALLMENTS);
    expect(metodos.excluded_payment_types).toBeUndefined();
  });

  it('cobra o total dos 12 meses, não o equivalente mensal do card', async () => {
    await paymentService.createOneTimeCheckout(user, 'PRO_ANNUAL');
    const [item] = bodyOf(preferenceCreate).items;

    expect(item.unit_price).toBe(PLANS.PRO_ANNUAL.price);
    expect(item.quantity).toBe(1);
  });

  it('leva a chave anual no external_reference para o webhook creditar 365 dias', async () => {
    await paymentService.createOneTimeCheckout(user, 'PRO_ANNUAL');

    expect(bodyOf(preferenceCreate).external_reference).toBe('u1:PRO_ANNUAL');
  });

  it('diz o período no título — a fatura do cliente não pode ser ambígua', async () => {
    await paymentService.createOneTimeCheckout(user, 'ELITE_ANNUAL');
    const [item] = bodyOf(preferenceCreate).items;

    expect(item.title).toContain('Anual');
    expect(item.description).toContain('365');
  });
});

describe('Checkout mensal avulso — o cartão continua barrado', () => {
  it('exclui o cartão e não parcela', async () => {
    await paymentService.createOneTimeCheckout(user, 'PRO');
    const { payment_methods: metodos } = bodyOf(preferenceCreate);

    expect(metodos.excluded_payment_types).toEqual([{ id: 'credit_card' }]);
    expect(metodos.installments).toBe(1);
  });
});

describe('Assinatura recorrente — o anual não entra por aqui', () => {
  it('recusa uma chave anual antes de falar com o Mercado Pago', async () => {
    // Se passasse, o MP cobraria R$598,80 TODO MÊS.
    await expect(paymentService.createRecurringSubscription(user, 'PRO_ANNUAL')).rejects.toThrow(/cobrança única/i);
    expect(preApprovalCreate).not.toHaveBeenCalled();
  });

  it('segue criando o preapproval mensal, com frequência de 1 mês', async () => {
    await paymentService.createRecurringSubscription(user, 'PRO');
    const { auto_recurring: recorrencia } = bodyOf(preApprovalCreate);

    expect(recorrencia.frequency).toBe(1);
    expect(recorrencia.frequency_type).toBe('months');
    expect(recorrencia.transaction_amount).toBe(PLANS.PRO.price);
  });
});
