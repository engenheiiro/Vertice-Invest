import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regressão: o checkout público aceitava qualquer chave de `PLANS`, incluindo as
// variantes _TEST (R$0,50). Como o webhook resolve TEST_PLAN_MAP para o plano
// real, `{"planId":"BLACK_TEST"}` vendia 30 dias de BLACK por R$0,50 a qualquer
// usuário autenticado. O gate agora é em três camadas: PUBLIC_PLAN_KEYS (config),
// checkoutSchema (Zod) e isTestPlan() no controller.

vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/Transaction.js', () => ({ default: { findOne: vi.fn(), create: vi.fn() } }));
vi.mock('../models/UsageLog.js', () => ({ default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/paymentService.js', () => ({
  paymentService: { createSubscription: vi.fn().mockResolvedValue({ init_point: 'https://mp/x', id: 'pref-1' }) },
}));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const { paymentService } = await import('../services/paymentService.js');
const { PLANS, PUBLIC_PLAN_KEYS, TEST_PLAN_MAP, isTestPlan } = await import('../config/subscription.js');
const { checkoutSchema } = await import('../schemas/subscriptionSchemas.js');
const { createCheckoutSession } = await import('../controllers/subscriptionController.js');

const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

const TEST_PLAN_KEYS = Object.keys(TEST_PLAN_MAP);

describe('Checkout público — planos de teste (R$0,50) fora de alcance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não expõe nenhuma variante _TEST na lista de planos vendáveis', () => {
    expect(PUBLIC_PLAN_KEYS).toEqual(['ESSENTIAL', 'PRO', 'ELITE', 'BLACK']);
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

  it('mantém os quatro planos reais vendáveis', () => {
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
      expect(paymentService.createSubscription).not.toHaveBeenCalled();
    }
  });

  it('segue criando a preferência para um plano real', async () => {
    const res = response();
    await createCheckoutSession({ body: { planId: 'BLACK' }, user: { id: 'u1' } }, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.redirectUrl).toBe('https://mp/x');
    expect(paymentService.createSubscription).toHaveBeenCalledWith({ id: 'u1' }, 'BLACK');
  });

  it('mantém o preço de teste desacoplado do preço real (a variante ainda existe p/ o admin)', () => {
    // /test-checkout (requireAdmin) continua funcionando: as variantes seguem em
    // PLANS, apenas não são mais alcançáveis pelo checkout público.
    for (const [testKey, realKey] of Object.entries(TEST_PLAN_MAP)) {
      expect(PLANS[testKey].price).toBe(0.5);
      expect(PLANS[realKey].price).toBeGreaterThan(0.5);
    }
  });
});
