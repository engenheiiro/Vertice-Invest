/**
 * Regras de período de acesso da assinatura (server/services/subscriptionService.js).
 *
 * Dois regimes convivem e a diferença é intencional:
 *  - ONE_TIME (Pix): ADITIVO, protegido pelo índice único em gatewayId.
 *  - RECURRING (cartão): ABSOLUTO, sempre igual ao next_payment_date do MP.
 *
 * O regime absoluto existe porque o MP notifica a MESMA cobrança por dois
 * tópicos; somar dias por evento creditaria dois meses. Estes testes travam
 * exatamente isso, além da carência que evita derrubar assinante adimplente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';

vi.mock('../models/Transaction.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));

const Transaction = (await import('../models/Transaction.js')).default;
const {
  grantOneTimePeriod,
  syncRecurringPeriod,
  isSubscriptionExpired,
  getAccessDeadline,
  markSubscriptionCanceled,
} = await import('../services/subscriptionService.js');
const { RECURRING_GRACE_DAYS } = await import('../config/subscription.js');

const DAY = 86_400_000;
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

beforeEach(() => vi.clearAllMocks());

describe('isSubscriptionExpired — carência só para assinatura recorrente', () => {
  it('avulso vence na data cravada, sem folga', () => {
    const user = makeUser({ subscriptionType: 'ONE_TIME', validUntil: new Date(Date.now() - 60_000) });
    expect(isSubscriptionExpired(user)).toBe(true);
  });

  it('recorrente sobrevive à janela de renovação (dentro da carência)', () => {
    // Vencido há 1 dia: o MP ainda vai cobrar/retentar. Derrubar aqui deixaria
    // um assinante adimplente como GUEST no meio do dia da renovação.
    const user = makeUser({
      subscriptionType: 'RECURRING',
      validUntil: new Date(Date.now() - 1 * DAY),
    });
    expect(isSubscriptionExpired(user)).toBe(false);
  });

  it('recorrente cai depois de esgotada a carência', () => {
    const user = makeUser({
      subscriptionType: 'RECURRING',
      validUntil: new Date(Date.now() - (RECURRING_GRACE_DAYS + 1) * DAY),
    });
    expect(isSubscriptionExpired(user)).toBe(true);
  });

  it('assinatura cancelada NÃO ganha carência — vale exatamente o período pago', () => {
    const user = makeUser({
      subscriptionType: 'RECURRING',
      subscriptionStatus: 'CANCELED',
      validUntil: new Date(Date.now() - 60_000),
    });
    expect(isSubscriptionExpired(user)).toBe(true);
  });

  it('GUEST e ADMIN nunca expiram', () => {
    expect(isSubscriptionExpired(makeUser({ plan: 'GUEST', validUntil: null }))).toBe(false);
    expect(isSubscriptionExpired(makeUser({ role: 'ADMIN', validUntil: null }))).toBe(false);
  });

  it('plano pago sem validUntil é tratado como expirado (fail-closed)', () => {
    expect(isSubscriptionExpired(makeUser({ validUntil: null }))).toBe(true);
    expect(getAccessDeadline(makeUser({ validUntil: null }))).toBeNull();
  });
});

describe('grantOneTimePeriod — aditivo e idempotente', () => {
  it('usa PLANS[plan].days em vez de um "+30" hardcoded', async () => {
    Transaction.create.mockResolvedValue({});
    const user = makeUser();
    const before = Date.now();

    const result = await grantOneTimePeriod(user, 'PRO', { gatewayId: 'pay-1', amount: 89.9, method: 'PIX' });

    expect(result.credited).toBe(true);
    expect(result.plan).toBe('PRO');
    const days = Math.round((result.validUntil.getTime() - before) / DAY);
    expect(days).toBe(30);
  });

  it('soma ao tempo restante quando o plano ainda está ativo', async () => {
    Transaction.create.mockResolvedValue({});
    const remaining = new Date(Date.now() + 10 * DAY);
    const user = makeUser({ validUntil: remaining });

    const result = await grantOneTimePeriod(user, 'ESSENTIAL', { gatewayId: 'pay-2', amount: 39.9, method: 'PIX' });

    const days = Math.round((result.validUntil.getTime() - remaining.getTime()) / DAY);
    expect(days).toBe(30);
  });

  it('credita o plano REAL a partir da variante _TEST (R$5,00)', async () => {
    Transaction.create.mockResolvedValue({});
    const user = makeUser();

    const result = await grantOneTimePeriod(user, 'BLACK_TEST', { gatewayId: 'pay-3', amount: 0.5, method: 'PIX' });

    expect(result.plan).toBe('BLACK');
    expect(user.plan).toBe('BLACK');
  });

  it('E11000 (entrega duplicada) não credita nem salva o usuário', async () => {
    Transaction.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    const user = makeUser();

    const result = await grantOneTimePeriod(user, 'PRO', { gatewayId: 'pay-1', amount: 89.9, method: 'PIX' });

    expect(result).toEqual({ credited: false, duplicated: true });
    expect(user.save).not.toHaveBeenCalled();
  });

  it('zera o calendário recorrente — compra avulsa não promete renovação', async () => {
    Transaction.create.mockResolvedValue({});
    const user = makeUser({ nextBillingDate: new Date(), subscriptionType: 'RECURRING' });

    await grantOneTimePeriod(user, 'PRO', { gatewayId: 'pay-4', amount: 89.9, method: 'PIX' });

    expect(user.subscriptionType).toBe('ONE_TIME');
    expect(user.nextBillingDate).toBeUndefined();
  });
});

describe('syncRecurringPeriod — absoluto, nunca aditivo', () => {
  const preapproval = (nextPaymentDate) => ({
    id: 'preapp-1',
    status: 'authorized',
    external_reference: 'user-1:PRO',
    payment_method_id: 'master',
    next_payment_date: nextPaymentDate,
  });

  it('ancora validUntil no next_payment_date do Mercado Pago', async () => {
    const next = new Date(Date.now() + 30 * DAY);
    const user = makeUser();

    const result = await syncRecurringPeriod(user, preapproval(next.toISOString()));

    expect(result.plan).toBe('PRO');
    expect(user.subscriptionType).toBe('RECURRING');
    expect(user.mpPreapprovalId).toBe('preapp-1');
    expect(user.cardBrand).toBe('master');
    expect(user.validUntil.toISOString()).toBe(next.toISOString());
    expect(user.nextBillingDate.toISOString()).toBe(next.toISOString());
  });

  it('reprocessar o mesmo evento produz exatamente o mesmo período (sem creditar 2 meses)', async () => {
    // Este é o cenário real: o MP notifica a mesma cobrança pelos tópicos
    // `payment` E `subscription_authorized_payment`.
    const next = new Date(Date.now() + 30 * DAY);
    const user = makeUser();

    await syncRecurringPeriod(user, preapproval(next.toISOString()));
    const first = user.validUntil.toISOString();
    await syncRecurringPeriod(user, preapproval(next.toISOString()));

    expect(user.validUntil.toISOString()).toBe(first);
  });

  it('limpa a marca de falha ao voltar a sincronizar com sucesso', async () => {
    const user = makeUser({ subscriptionStatus: 'PAST_DUE', lastPaymentFailedAt: new Date() });

    await syncRecurringPeriod(user, preapproval(new Date(Date.now() + 30 * DAY).toISOString()));

    expect(user.subscriptionStatus).toBe('ACTIVE');
    expect(user.lastPaymentFailedAt).toBeUndefined();
  });

  it('sem next_payment_date, garante um período mínimo em vez de deixar sem acesso', async () => {
    const user = makeUser({ validUntil: null });

    await syncRecurringPeriod(user, { ...preapproval(null), next_payment_date: null });

    expect(user.validUntil).toBeInstanceOf(Date);
    expect(user.validUntil.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('markSubscriptionCanceled — cancelar não é estornar', () => {
  it('preserva plano e validUntil, só interrompe a cobrança futura', async () => {
    const validUntil = new Date(Date.now() + 12 * DAY);
    const user = makeUser({
      plan: 'ELITE',
      subscriptionType: 'RECURRING',
      validUntil,
      nextBillingDate: validUntil,
    });

    await markSubscriptionCanceled(user);

    expect(user.subscriptionStatus).toBe('CANCELED');
    expect(user.plan).toBe('ELITE');
    expect(user.validUntil).toBe(validUntil);
    expect(user.nextBillingDate).toBeUndefined();
  });
});
