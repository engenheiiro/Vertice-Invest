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
vi.mock('../services/paymentService.js', () => ({ paymentService: { createOneTimeCheckout: vi.fn(), createRecurringSubscription: vi.fn(), getPaymentStatus: vi.fn(), getPreapproval: vi.fn() } }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const { paymentService } = await import('../services/paymentService.js');
const { handlePaymentReturn, createTestCheckoutSession, createCheckoutSession } = await import('../controllers/subscriptionController.js');

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

  it('lê o plano do PATH no retorno recorrente e marca o modo', async () => {
    // O back_url do preapproval não pode ter query string, então o plano viaja
    // pelo path (/return/:plan) e o MP anexa o preapproval_id por conta própria.
    const res = mockRes();
    await handlePaymentReturn({ params: { plan: 'ELITE_TEST' }, query: { preapproval_id: 'preapp-1' } }, res);

    const target = new URL(res.redirectUrl);
    expect(target.searchParams.get('plan')).toBe('ELITE_TEST');
    expect(target.searchParams.get('preapproval_id')).toBe('preapp-1');
    expect(target.searchParams.get('mode')).toBe('recurring');
  });

  it('resgata o preapproval_id que o MP grudou dentro de outro parâmetro', async () => {
    // Regressão real: com query string no back_url, o MP concatenou
    // "?preapproval_id=..." no fim, produzindo return_status="success?preapproval_id=X".
    // O identificador sumia e o cliente pagava sem ver a assinatura ativar.
    const res = mockRes();
    await handlePaymentReturn({
      params: {},
      query: { plan: 'ELITE', return_status: 'success?preapproval_id=69CACAE919C14904A53C0AF42C927673' },
    }, res);

    const target = new URL(res.redirectUrl);
    expect(target.searchParams.get('preapproval_id')).toBe('69CACAE919C14904A53C0AF42C927673');
    expect(target.searchParams.get('return_status')).toBe('success');
    expect(target.searchParams.get('mode')).toBe('recurring');
  });

  it('não marca modo recorrente num retorno avulso', async () => {
    const res = mockRes();
    await handlePaymentReturn({ params: {}, query: { plan: 'PRO', payment_id: '123', status: 'approved' } }, res);

    const target = new URL(res.redirectUrl);
    expect(target.searchParams.has('mode')).toBe(false);
    expect(target.searchParams.has('preapproval_id')).toBe(false);
  });

  it('não encaminha plano injetado que não exista na configuração', async () => {
    const res = mockRes();
    await handlePaymentReturn({ query: { plan: 'BLACK_GRÁTIS', payment_id: '123', status: 'approved' } }, res);

    const target = new URL(res.redirectUrl);
    expect(target.searchParams.has('plan')).toBe(false);
    expect(target.searchParams.get('payment_id')).toBe('123');
  });

  it('mantém o checkout de teste de R$0,50 restrito ao fluxo *_TEST', async () => {
    paymentService.createOneTimeCheckout.mockResolvedValue({ init_point: 'https://mp.test/checkout', id: 'pref-1' });
    const req = { body: { planKey: 'ELITE' }, user: { id: 'admin-1' } };
    const res = mockRes();

    await createTestCheckoutSession(req, res, (error) => { throw error; });

    expect(paymentService.createOneTimeCheckout).toHaveBeenCalledWith(req.user, 'ELITE_TEST');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ redirectUrl: 'https://mp.test/checkout', subscriptionId: 'pref-1' });
  });
});

describe('createCheckoutSession — início da cobrança recorrente', () => {
  const DAY = 86_400_000;

  it('adia a 1ª cobrança para o fim do período já pago (não descarta dias de Pix)', async () => {
    paymentService.createRecurringSubscription.mockResolvedValue({ init_point: 'https://mp/sub', id: 'preapp-1' });
    const validUntil = new Date(Date.now() + 20 * DAY);
    const res = mockRes();

    await createCheckoutSession(
      { body: { planId: 'PRO', mode: 'RECURRING' }, user: { id: 'u1', validUntil } },
      res,
      (error) => { throw error; },
    );

    expect(paymentService.createRecurringSubscription).toHaveBeenCalledWith(
      expect.anything(), 'PRO', { startDate: validUntil },
    );
  });

  it('cobra na hora quem não tem saldo restante', async () => {
    paymentService.createRecurringSubscription.mockResolvedValue({ init_point: 'https://mp/sub', id: 'preapp-1' });
    const res = mockRes();

    await createCheckoutSession(
      { body: { planId: 'PRO', mode: 'RECURRING' }, user: { id: 'u1', validUntil: new Date(Date.now() - DAY) } },
      res,
      (error) => { throw error; },
    );

    expect(paymentService.createRecurringSubscription).toHaveBeenCalledWith(
      expect.anything(), 'PRO', { startDate: null },
    );
  });

  it('ignora validade distante (acesso concedido à mão, não período comprado)', async () => {
    // Contas internas costumam ter validUntil em datas remotas. Adiar a cobrança
    // para lá deixaria a assinatura sem cobrar por anos.
    paymentService.createRecurringSubscription.mockResolvedValue({ init_point: 'https://mp/sub', id: 'preapp-1' });
    const res = mockRes();

    await createCheckoutSession(
      { body: { planId: 'PRO', mode: 'RECURRING' }, user: { id: 'u1', validUntil: new Date('2100-03-31') } },
      res,
      (error) => { throw error; },
    );

    expect(paymentService.createRecurringSubscription).toHaveBeenCalledWith(
      expect.anything(), 'PRO', { startDate: null },
    );
  });
});
