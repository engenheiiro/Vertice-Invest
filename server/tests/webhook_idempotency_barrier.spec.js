/**
 * F2 — Idempotência do webhook via índice único (barreira atômica).
 *
 * O Mercado Pago envia notificações duplicadas para o mesmo pagamento (retries,
 * múltiplos tópicos). O `findOne(gatewayId)` é apenas fast-path; a garantia real
 * é criar a Transaction ANTES de estender o plano — o índice único em gatewayId
 * faz a 2ª entrega falhar com E11000, sem creditar +30 dias em dobro.
 *
 * Aqui simulamos a corrida: a 2ª entrega passa pelo findOne (ainda null) mas o
 * Transaction.create colide (E11000). Verificamos que o plano NÃO é estendido de
 * novo e a resposta é 200 (idempotente).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';

vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../models/Transaction.js', () => ({ default: { findOne: vi.fn(), create: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/paymentService.js', () => ({ paymentService: { getPaymentStatus: vi.fn() } }));
vi.mock('../services/emailService.js', () => ({ sendCheckoutConfirmationEmail: vi.fn().mockResolvedValue() }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const User = (await import('../models/User.js')).default;
const Transaction = (await import('../models/Transaction.js')).default;
const { paymentService } = await import('../services/paymentService.js');
const { invalidateUser } = await import('../utils/userCache.js');
const { handleMercadoPagoWebhook } = await import('../controllers/webhookController.js');

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
};

const paymentReq = () => ({ body: { type: 'payment', data: { id: 'pay-race-1' } }, query: {}, headers: {}, ip: '127.0.0.1' });

beforeEach(() => vi.clearAllMocks());

describe('webhook MP — barreira de idempotência por índice único (F2)', () => {
  it('entrega duplicada em corrida (E11000): NÃO estende plano de novo e responde 200', async () => {
    Transaction.findOne.mockResolvedValue(null); // fast-path não pega (corrida)
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'approved', transaction_amount: 49.9,
      external_reference: 'user-1:ESSENTIAL', payment_type_id: 'bank_transfer',
    });
    const user = { _id: 'user-1', email: 'a@b.com', validUntil: null, save: vi.fn().mockResolvedValue() };
    User.findById.mockResolvedValue(user);
    // O índice único rejeita a 2ª criação concorrente.
    Transaction.create.mockRejectedValue(Object.assign(new Error('dup key'), { code: 11000 }));

    const res = mockRes();
    await handleMercadoPagoWebhook(paymentReq(), res);

    expect(Transaction.create).toHaveBeenCalledOnce();
    expect(user.save).not.toHaveBeenCalled();      // plano NÃO estendido de novo
    expect(invalidateUser).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('1ª entrega (create OK): estende plano exatamente uma vez', async () => {
    Transaction.findOne.mockResolvedValue(null);
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'approved', transaction_amount: 49.9,
      external_reference: 'user-1:ESSENTIAL', payment_type_id: 'bank_transfer',
    });
    const user = { _id: 'user-1', email: 'a@b.com', validUntil: null, save: vi.fn().mockResolvedValue() };
    User.findById.mockResolvedValue(user);
    Transaction.create.mockResolvedValue({ _id: 'tx-1' });

    const res = mockRes();
    await handleMercadoPagoWebhook(paymentReq(), res);

    expect(Transaction.create).toHaveBeenCalledOnce();
    expect(user.save).toHaveBeenCalledOnce();
    expect(user.plan).toBe('ESSENTIAL');
    expect(invalidateUser).toHaveBeenCalledWith('user-1');
    expect(res.statusCode).toBe(200);
  });
});
