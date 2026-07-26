/**
 * Webhook MP — tópicos de assinatura recorrente.
 *
 * O risco central desta feature é o duplo crédito: uma única cobrança mensal
 * chega por DOIS tópicos (`payment` e `subscription_authorized_payment`). O teste
 * mais importante daqui é justamente esse — as duas entregas devem produzir uma
 * única Transaction e um único período, sem somar 60 dias.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';

vi.mock('../models/User.js', () => ({ default: { findById: vi.fn(), findOne: vi.fn() } }));
vi.mock('../models/Transaction.js', () => ({ default: { findOne: vi.fn(), create: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../services/paymentService.js', () => ({
  paymentService: {
    getPaymentStatus: vi.fn(),
    getPreapproval: vi.fn(),
    getAuthorizedPayment: vi.fn(),
  },
}));
vi.mock('../services/emailService.js', () => ({
  sendCheckoutConfirmationEmail: vi.fn().mockResolvedValue(),
  sendSubscriptionCreatedEmail: vi.fn().mockResolvedValue(),
  sendRenewalReceiptEmail: vi.fn().mockResolvedValue(),
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(),
  sendSubscriptionCanceledEmail: vi.fn().mockResolvedValue(),
}));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const User = (await import('../models/User.js')).default;
const Transaction = (await import('../models/Transaction.js')).default;
const { paymentService } = await import('../services/paymentService.js');
const emails = await import('../services/emailService.js');
const { handleMercadoPagoWebhook } = await import('../controllers/webhookController.js');

const DAY = 86_400_000;

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
};

const req = (type, id) => ({ body: { type, data: { id } }, query: {}, headers: {}, ip: '127.0.0.1' });

const makeUser = (overrides = {}) => ({
  _id: 'user-1',
  email: 'a@b.com',
  plan: 'ESSENTIAL',
  role: 'USER',
  subscriptionStatus: 'ACTIVE',
  subscriptionType: 'ONE_TIME',
  validUntil: null,
  save: vi.fn().mockResolvedValue(),
  ...overrides,
});

const NEXT = new Date(Date.now() + 30 * DAY);
const preapproval = (overrides = {}) => ({
  id: 'preapp-1',
  status: 'authorized',
  external_reference: 'user-1:PRO',
  payment_method_id: 'master',
  next_payment_date: NEXT.toISOString(),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('tópico subscription_preapproval — ciclo de vida', () => {
  it('authorized: ativa a assinatura, ancora o período no MP e avisa por e-mail', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    paymentService.getPreapproval.mockResolvedValue(preapproval());

    const res = mockRes();
    await handleMercadoPagoWebhook(req('subscription_preapproval', 'preapp-1'), res);

    expect(user.plan).toBe('PRO');
    expect(user.subscriptionType).toBe('RECURRING');
    expect(user.subscriptionStatus).toBe('ACTIVE');
    expect(user.mpPreapprovalId).toBe('preapp-1');
    expect(user.validUntil.toISOString()).toBe(NEXT.toISOString());
    expect(emails.sendSubscriptionCreatedEmail).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('authorized numa renovação não repete o e-mail de boas-vindas', async () => {
    const user = makeUser({ subscriptionType: 'RECURRING', plan: 'PRO' });
    User.findById.mockResolvedValue(user);
    paymentService.getPreapproval.mockResolvedValue(preapproval());

    await handleMercadoPagoWebhook(req('subscription_preapproval', 'preapp-1'), mockRes());

    expect(emails.sendSubscriptionCreatedEmail).not.toHaveBeenCalled();
  });

  it('tentativa que morre antes de ser autorizada NÃO cancela a assinatura do usuário', async () => {
    // Cenário real de produção: cartão recusado na 1ª cobrança → o MP cancela o
    // preapproval recém-criado. Esse evento não pode derrubar o que o usuário já
    // tinha (outra assinatura, ou um plano concedido por fora).
    const validUntil = new Date(Date.now() + 300 * DAY);
    const user = makeUser({ plan: 'ELITE', subscriptionStatus: 'ACTIVE', validUntil, mpPreapprovalId: undefined });
    User.findById.mockResolvedValue(user);
    paymentService.getPreapproval.mockResolvedValue(preapproval({ id: 'preapp-natimorto', status: 'cancelled' }));

    await handleMercadoPagoWebhook(req('subscription_preapproval', 'preapp-natimorto'), mockRes());

    expect(user.subscriptionStatus).toBe('ACTIVE');
    expect(user.validUntil).toBe(validUntil);
    expect(user.save).not.toHaveBeenCalled();
    expect(emails.sendSubscriptionCanceledEmail).not.toHaveBeenCalled();
  });

  it('cancelled: encerra a cobrança mas PRESERVA o acesso já pago', async () => {
    const validUntil = new Date(Date.now() + 12 * DAY);
    const user = makeUser({ plan: 'PRO', subscriptionType: 'RECURRING', validUntil, mpPreapprovalId: 'preapp-1' });
    User.findById.mockResolvedValue(user);
    paymentService.getPreapproval.mockResolvedValue(preapproval({ status: 'cancelled' }));

    await handleMercadoPagoWebhook(req('subscription_preapproval', 'preapp-1'), mockRes());

    expect(user.subscriptionStatus).toBe('CANCELED');
    expect(user.plan).toBe('PRO');          // não rebaixa na hora
    expect(user.validUntil).toBe(validUntil); // não estorna o período pago
    expect(emails.sendSubscriptionCanceledEmail).toHaveBeenCalledOnce();
  });

  it('reentrega do mesmo cancelamento não dispara um segundo e-mail', async () => {
    // O MP reenviou o evento "cancelled" três vezes em dois minutos na produção.
    const user = makeUser({
      plan: 'PRO', subscriptionType: 'RECURRING', subscriptionStatus: 'CANCELED',
      mpPreapprovalId: 'preapp-1',
    });
    User.findById.mockResolvedValue(user);
    paymentService.getPreapproval.mockResolvedValue(preapproval({ status: 'cancelled' }));

    await handleMercadoPagoWebhook(req('subscription_preapproval', 'preapp-1'), mockRes());

    expect(user.save).not.toHaveBeenCalled();
    expect(emails.sendSubscriptionCanceledEmail).not.toHaveBeenCalled();
  });

  it('paused: marca PAUSED sem tocar no plano', async () => {
    const user = makeUser({ plan: 'PRO', subscriptionType: 'RECURRING', mpPreapprovalId: 'preapp-1' });
    User.findById.mockResolvedValue(user);
    paymentService.getPreapproval.mockResolvedValue(preapproval({ status: 'paused' }));

    await handleMercadoPagoWebhook(req('subscription_preapproval', 'preapp-1'), mockRes());

    expect(user.subscriptionStatus).toBe('PAUSED');
    expect(user.plan).toBe('PRO');
  });

  it('assinante não encontrado: responde 200 (não faz o MP reentregar para sempre)', async () => {
    User.findById.mockResolvedValue(null);
    User.findOne.mockResolvedValue(null);
    paymentService.getPreapproval.mockResolvedValue(preapproval());

    const res = mockRes();
    await handleMercadoPagoWebhook(req('subscription_preapproval', 'preapp-1'), res);

    expect(res.statusCode).toBe(200);
  });
});

describe('tópico subscription_authorized_payment — cobrança mensal', () => {
  it('processed: registra a cobrança pelo id do PAGAMENTO e ressincroniza o período', async () => {
    const user = makeUser({ plan: 'PRO', subscriptionType: 'RECURRING', mpPreapprovalId: 'preapp-1' });
    User.findById.mockResolvedValue(user);
    Transaction.create.mockResolvedValue({});
    paymentService.getAuthorizedPayment.mockResolvedValue({
      id: 'authpay-1',
      status: 'processed',
      preapproval_id: 'preapp-1',
      external_reference: 'user-1:PRO',
      transaction_amount: 89.9,
      payment: { id: 'pay-999' },
    });
    paymentService.getPreapproval.mockResolvedValue(preapproval());

    await handleMercadoPagoWebhook(req('subscription_authorized_payment', 'authpay-1'), mockRes());

    // gatewayId precisa ser o id do pagamento real — é o mesmo que o tópico
    // `payment` usaria, e é isso que faz o índice único cobrir os dois caminhos.
    expect(Transaction.create).toHaveBeenCalledWith(expect.objectContaining({ gatewayId: 'pay-999' }));
    expect(user.validUntil.toISOString()).toBe(NEXT.toISOString());
    expect(emails.sendRenewalReceiptEmail).toHaveBeenCalledOnce();
  });

  it('recusa numa assinatura que não governa a conta é ignorada', async () => {
    // Cenário real: o usuário tenta assinar de novo, o cartão recusa e o MP avisa.
    // Isso não pode marcar como PAST_DUE (nem gerar e-mail sobre) a assinatura
    // anterior, que segue saudável.
    const user = makeUser({
      plan: 'ELITE', subscriptionStatus: 'ACTIVE', subscriptionType: 'RECURRING',
      mpPreapprovalId: 'preapp-vigente',
    });
    User.findById.mockResolvedValue(user);
    paymentService.getAuthorizedPayment.mockResolvedValue({
      id: 'authpay-x', status: 'rejected', preapproval_id: 'preapp-natimorto',
      external_reference: 'user-1:ELITE',
    });

    await handleMercadoPagoWebhook(req('subscription_authorized_payment', 'authpay-x'), mockRes());

    expect(user.subscriptionStatus).toBe('ACTIVE');
    expect(user.save).not.toHaveBeenCalled();
    expect(emails.sendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it('reentrega da mesma recusa não dispara um segundo e-mail', async () => {
    const user = makeUser({
      plan: 'PRO', subscriptionStatus: 'PAST_DUE', subscriptionType: 'RECURRING',
      mpPreapprovalId: 'preapp-1',
    });
    User.findById.mockResolvedValue(user);
    paymentService.getAuthorizedPayment.mockResolvedValue({
      id: 'authpay-2', status: 'rejected', preapproval_id: 'preapp-1',
      external_reference: 'user-1:PRO',
    });

    await handleMercadoPagoWebhook(req('subscription_authorized_payment', 'authpay-2'), mockRes());

    expect(emails.sendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it('rejected: marca PAST_DUE e pede novo cartão, SEM rebaixar o plano', async () => {
    const validUntil = new Date(Date.now() + 1 * DAY);
    const user = makeUser({ plan: 'PRO', subscriptionType: 'RECURRING', mpPreapprovalId: 'preapp-1', validUntil });
    User.findById.mockResolvedValue(user);
    paymentService.getAuthorizedPayment.mockResolvedValue({
      id: 'authpay-2',
      status: 'rejected',
      preapproval_id: 'preapp-1',
      external_reference: 'user-1:PRO',
    });

    await handleMercadoPagoWebhook(req('subscription_authorized_payment', 'authpay-2'), mockRes());

    expect(user.subscriptionStatus).toBe('PAST_DUE');
    expect(user.lastPaymentFailedAt).toBeInstanceOf(Date);
    expect(user.plan).toBe('PRO'); // a carência cobre as retentativas do MP
    expect(emails.sendPaymentFailedEmail).toHaveBeenCalledOnce();
    expect(Transaction.create).not.toHaveBeenCalled();
  });

  it('cobrança já registrada (E11000) não dispara recibo duplicado', async () => {
    const user = makeUser({ plan: 'PRO', subscriptionType: 'RECURRING', mpPreapprovalId: 'preapp-1' });
    User.findById.mockResolvedValue(user);
    Transaction.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    paymentService.getAuthorizedPayment.mockResolvedValue({
      id: 'authpay-3', status: 'processed', preapproval_id: 'preapp-1',
      external_reference: 'user-1:PRO', transaction_amount: 89.9, payment: { id: 'pay-999' },
    });
    paymentService.getPreapproval.mockResolvedValue(preapproval());

    await handleMercadoPagoWebhook(req('subscription_authorized_payment', 'authpay-3'), mockRes());

    expect(emails.sendRenewalReceiptEmail).not.toHaveBeenCalled();
  });
});

describe('tópico payment em assinante recorrente — o cenário de duplo crédito', () => {
  it('a mesma cobrança pelos dois tópicos gera UMA Transaction e UM período', async () => {
    const user = makeUser({ plan: 'PRO', subscriptionType: 'RECURRING', mpPreapprovalId: 'preapp-1' });
    User.findById.mockResolvedValue(user);
    paymentService.getPreapproval.mockResolvedValue(preapproval());

    // 1ª entrega: tópico `subscription_authorized_payment`.
    Transaction.create.mockResolvedValueOnce({});
    paymentService.getAuthorizedPayment.mockResolvedValue({
      id: 'authpay-1', status: 'processed', preapproval_id: 'preapp-1',
      external_reference: 'user-1:PRO', transaction_amount: 89.9, payment: { id: 'pay-999' },
    });
    await handleMercadoPagoWebhook(req('subscription_authorized_payment', 'authpay-1'), mockRes());
    const afterFirst = user.validUntil.toISOString();

    // 2ª entrega: mesma cobrança, agora pelo tópico `payment`. O índice único
    // rejeita a Transaction e o período continua vindo do MP (absoluto).
    Transaction.findOne.mockResolvedValue(null); // simula a corrida (fast-path não pega)
    Transaction.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'approved', transaction_amount: 89.9,
      external_reference: 'user-1:PRO', payment_type_id: 'credit_card',
    });
    await handleMercadoPagoWebhook(req('payment', 'pay-999'), mockRes());

    expect(Transaction.create).toHaveBeenCalledTimes(2); // ambas tentaram...
    expect(user.validUntil.toISOString()).toBe(afterFirst); // ...mas o período não dobrou
    expect(emails.sendRenewalReceiptEmail).toHaveBeenCalledOnce();
  });

  it('primeira cobrança que chega antes do preapproval authorized não credita 30 dias por cima', async () => {
    // Corrida real: o usuário ainda está marcado como ONE_TIME, mas o pagamento
    // carrega metadata.preapproval_id. Sem esse discriminador, cairia no fluxo
    // aditivo e o período divergiria do calendário do MP.
    const user = makeUser({ subscriptionType: 'ONE_TIME' });
    User.findById.mockResolvedValue(user);
    Transaction.findOne.mockResolvedValue(null);
    Transaction.create.mockResolvedValue({});
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'approved', transaction_amount: 89.9,
      external_reference: 'user-1:PRO', payment_type_id: 'credit_card',
      metadata: { preapproval_id: 'preapp-1' },
    });
    paymentService.getPreapproval.mockResolvedValue(preapproval());

    await handleMercadoPagoWebhook(req('payment', 'pay-1000'), mockRes());

    expect(user.subscriptionType).toBe('RECURRING');
    expect(user.validUntil.toISOString()).toBe(NEXT.toISOString());
    expect(emails.sendCheckoutConfirmationEmail).not.toHaveBeenCalled();
  });

  it('Pix avulso segue no fluxo aditivo de sempre', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    Transaction.findOne.mockResolvedValue(null);
    Transaction.create.mockResolvedValue({});
    paymentService.getPaymentStatus.mockResolvedValue({
      status: 'approved', transaction_amount: 39.9,
      external_reference: 'user-1:ESSENTIAL', payment_type_id: 'bank_transfer',
    });

    await handleMercadoPagoWebhook(req('payment', 'pay-pix-1'), mockRes());

    expect(user.subscriptionType).toBe('ONE_TIME');
    expect(user.plan).toBe('ESSENTIAL');
    expect(Math.round((user.validUntil.getTime() - Date.now()) / DAY)).toBe(30);
    expect(emails.sendCheckoutConfirmationEmail).toHaveBeenCalledOnce();
    expect(paymentService.getPreapproval).not.toHaveBeenCalled();
  });
});
