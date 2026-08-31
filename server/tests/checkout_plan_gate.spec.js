import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regressão: o checkout público aceitava qualquer chave de `PLANS`, incluindo as
// variantes _TEST (R$0,50). Como o webhook resolve a variante para o plano real,
// `{"planId":"BLACK_TEST"}` vendia 30 dias de BLACK por R$0,50 a qualquer
// usuário autenticado. O gate agora é em três camadas: PUBLIC_PLAN_KEYS (config),
// checkoutSchema (Zod) e isTestPlan() no controller.
//
// A tabela ganhou uma segunda dimensão (ciclo mensal x anual), o que multiplicou
// as chaves de checkout por quatro. O gate precisa continuar valendo em TODAS —
// inclusive nas variantes de teste anuais.

vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/Transaction.js', () => ({ default: { findOne: vi.fn(), create: vi.fn() } }));
vi.mock('../models/UsageLog.js', () => ({ default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/paymentService.js', () => ({
  paymentService: {
    createOneTimeCheckout: vi.fn().mockResolvedValue({ init_point: 'https://mp/x', id: 'pref-1' }),
    createRecurringSubscription: vi.fn().mockResolvedValue({ init_point: 'https://mp/sub', id: 'preapp-1' }),
  },
}));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const { paymentService } = await import('../services/paymentService.js');
const { PLANS, PUBLIC_PLAN_KEYS, RETIRED_PLAN_KEYS, basePlanOf, isAnnualPlan, isTestPlan, isRetiredPlan } = await import('../config/subscription.js');
const { checkoutSchema } = await import('../schemas/subscriptionSchemas.js');
const { createCheckoutSession } = await import('../controllers/subscriptionController.js');

const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

const TEST_PLAN_KEYS = Object.keys(PLANS).filter(isTestPlan);

describe('Checkout público — planos de teste (R$0,50) fora de alcance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não expõe nenhuma variante _TEST na lista de planos vendáveis', () => {
    expect(PUBLIC_PLAN_KEYS).toEqual([
      'ESSENTIAL', 'ESSENTIAL_ANNUAL', 'PRO', 'PRO_ANNUAL', 'ELITE', 'ELITE_ANNUAL',
    ]);
    expect(TEST_PLAN_KEYS).toHaveLength(7); // 4 mensais + 3 anuais (o BLACK não tem anual)
    for (const key of TEST_PLAN_KEYS) {
      expect(PUBLIC_PLAN_KEYS).not.toContain(key);
      expect(isTestPlan(key)).toBe(true);
    }
  });

  it('rejeita todas as variantes _TEST já no schema do checkout', () => {
    for (const key of TEST_PLAN_KEYS) {
      const parsed = checkoutSchema.safeParse({ body: { planId: key }, query: {}, params: {} });
      expect(parsed.success, `${key} deveria ser rejeitado pelo schema`).toBe(false);
    }
  });

  it('mantém os três planos reais vendáveis', () => {
    for (const key of PUBLIC_PLAN_KEYS) {
      const parsed = checkoutSchema.safeParse({ body: { planId: key }, query: {}, params: {} });
      expect(parsed.success, `${key} deveria ser aceito`).toBe(true);
    }
  });

  it('barra o plano de teste no controller mesmo se o schema for afrouxado', async () => {
    // Simula o bypass: chama o handler direto, sem passar pelo validate().
    for (const key of TEST_PLAN_KEYS) {
      const res = response();
      await createCheckoutSession({ body: { planId: key }, user: { id: 'u1' } }, res, vi.fn());

      expect(res.statusCode, `${key} deveria ser barrado no controller`).toBe(400);
      expect(paymentService.createOneTimeCheckout).not.toHaveBeenCalled();
      expect(paymentService.createRecurringSubscription).not.toHaveBeenCalled();
    }
  });

  it('segue criando a preferência para um plano real', async () => {
    const res = response();
    await createCheckoutSession({ body: { planId: 'ELITE' }, user: { id: 'u1' } }, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.redirectUrl).toBe('https://mp/x');
    expect(paymentService.createOneTimeCheckout).toHaveBeenCalledWith({ id: 'u1' }, 'ELITE');
  });

  it('roteia o modo RECURRING para o PreApproval, não para a Preference', async () => {
    const res = response();
    await createCheckoutSession({ body: { planId: 'PRO', mode: 'RECURRING' }, user: { id: 'u1' } }, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.redirectUrl).toBe('https://mp/sub');
    expect(paymentService.createRecurringSubscription).toHaveBeenCalledWith({ id: 'u1' }, 'PRO', { startDate: null });
    expect(paymentService.createOneTimeCheckout).not.toHaveBeenCalled();
  });

  it('mantém o plano aposentado conhecido, mas fora da venda', () => {
    // O BLACK virou consultoria avulsa. A chave PRECISA continuar em PLANS: quem já
    // assina depende dela para rótulo, gate e renovação do preapproval. O que não pode
    // é alguém novo comprar — nem pelo schema, nem pelo controller.
    for (const key of RETIRED_PLAN_KEYS) {
      expect(PLANS[key], `${key} não pode sumir de PLANS`).toBeDefined();
      expect(isRetiredPlan(key)).toBe(true);
      expect(PUBLIC_PLAN_KEYS).not.toContain(key);

      const parsed = checkoutSchema.safeParse({ body: { planId: key }, query: {}, params: {} });
      expect(parsed.success, `${key} deveria ser rejeitado pelo schema`).toBe(false);
    }
  });

  it('mantém o preço de teste desacoplado do preço real (a variante ainda existe p/ o admin)', () => {
    // /test-checkout (requireAdmin) continua funcionando: as variantes seguem em
    // PLANS, apenas não são mais alcançáveis pelo checkout público.
    for (const testKey of TEST_PLAN_KEYS) {
      const realKey = testKey.replace(/_TEST$/, '');
      expect(PLANS[testKey].price).toBe(0.5);
      expect(PLANS[realKey].price).toBeGreaterThan(PLANS[testKey].price);
      // Mesmo período do plano real: testar o anual precisa exercitar 365 dias.
      expect(PLANS[testKey].days).toBe(PLANS[realKey].days);
      expect(PLANS[testKey].cycle).toBe(PLANS[realKey].cycle);
    }
  });
});

describe('Ciclo anual — produto vendável, nunca assinatura recorrente', () => {
  beforeEach(() => vi.clearAllMocks());

  it('credita o plano base: PRO_ANNUAL dá acesso PRO, não um plano novo', () => {
    for (const key of ['PRO_ANNUAL', 'PRO_ANNUAL_TEST', 'PRO_TEST', 'PRO']) {
      expect(basePlanOf(key)).toBe('PRO');
    }
  });

  it('cobra o total de 12 meses e libera 365 dias', () => {
    for (const base of ['ESSENTIAL', 'PRO', 'ELITE']) {
      const anual = PLANS[`${base}_ANNUAL`];
      expect(anual.days).toBe(365);
      // Desconto real, não o mesmo preço em outra embalagem.
      expect(anual.price).toBeLessThan(PLANS[base].price * 12);
    }
  });

  it('não cria plano anual para o plano aposentado', () => {
    expect(PLANS.BLACK_ANNUAL).toBeUndefined();
  });

  it('manda o anual para a Preference mesmo quando o cliente pede RECURRING', async () => {
    // O PreApproval do MP não parcela. Recusar devolveria erro para algo que
    // sabemos servir — o comprador escolhe cartão ou Pix dentro do checkout.
    const res = response();
    await createCheckoutSession({ body: { planId: 'PRO_ANNUAL', mode: 'RECURRING' }, user: { id: 'u1' } }, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(paymentService.createOneTimeCheckout).toHaveBeenCalledWith({ id: 'u1' }, 'PRO_ANNUAL');
    expect(paymentService.createRecurringSubscription).not.toHaveBeenCalled();
  });

  it('mantém o mensal no PreApproval — o roteamento por ciclo não vazou para ele', async () => {
    const res = response();
    await createCheckoutSession({ body: { planId: 'PRO', mode: 'RECURRING' }, user: { id: 'u1' } }, res, vi.fn());

    expect(isAnnualPlan('PRO')).toBe(false);
    expect(paymentService.createRecurringSubscription).toHaveBeenCalled();
    expect(paymentService.createOneTimeCheckout).not.toHaveBeenCalled();
  });
});
