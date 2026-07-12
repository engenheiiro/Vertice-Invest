/**
 * Contrato do retorno do Checkout Pro e do checkout de teste administrativo.
 * O navegador só recebe parâmetros para exibição/sincronização; a concessão de
 * plano continua exclusivamente no webhook ou no sync-payment autenticado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/Transaction.js', () => ({ default: { create: vi.fn(), findOne: vi.fn() } }));
vi.mock('../models/UsageLog.js', () => ({ default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../services/paymentService.js', () => ({ paymentService: { createSubscription: vi.fn(), getPaymentStatus: vi.fn() } }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const { paymentService } = await import('../services/paymentService.js');
const { handlePaymentReturn, createTestCheckoutSession } = await import('../controllers/subscriptionController.js');

const mockRes = () => {
  const res = { statusCode: 200, body: null, redirectUrl: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.redirect = (url) => { res.redirectUrl = url; return res; };
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CLIENT_URL', 'https://app.vertice.test');
});

describe('handlePaymentReturn — contrato BrowserRouter do Checkout Pro', () => {
  it('encaminha os parâmetros oficiais sem hash e preserva o payment_id autoritativo do gateway', async () => {
    const req = {
      query: {
        plan: 'PRO',
        payment_id: '123456',
        collection_id: '123456',
        status: 'approved',
        collection_status: 'approved',
        external_reference: 'user-1:PRO',
        unexpected: 'não-vaza',
      },
    };
    const res = mockRes();

    await handlePaymentReturn(req, res);

    const target = new URL(res.redirectUrl);
    expect(`${target.origin}${target.pathname}`).toBe('https://app.vertice.test/checkout/success');
    expect(res.redirectUrl).not.toContain('/#/');
    expect(target.searchParams.get('plan')).toBe('PRO');
    expect(target.searchParams.get('payment_id')).toBe('123456');
    expect(target.searchParams.get('collection_status')).toBe('approved');
    expect(target.searchParams.has('unexpected')).toBe(false);
  });

  it('não encaminha plano injetado que não exista na configuração', async () => {
    const res = mockRes();
    await handlePaymentReturn({ query: { plan: 'BLACK_GRÁTIS', payment_id: '123', status: 'approved' } }, res);

    const target = new URL(res.redirectUrl);
    expect(target.searchParams.has('plan')).toBe(false);
    expect(target.searchParams.get('payment_id')).toBe('123');
  });

  it('mantém o checkout de teste de R$0,50 restrito ao fluxo *_TEST', async () => {
    paymentService.createSubscription.mockResolvedValue({ init_point: 'https://mp.test/checkout', id: 'pref-1' });
    const req = { body: { planKey: 'ELITE' }, user: { id: 'admin-1' } };
    const res = mockRes();

    await createTestCheckoutSession(req, res, (error) => { throw error; });

    expect(paymentService.createSubscription).toHaveBeenCalledWith(req.user, 'ELITE_TEST');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ redirectUrl: 'https://mp.test/checkout', subscriptionId: 'pref-1' });
  });
});
