/**
 * Cobrança anual (Onda 4 do plano comercial).
 *
 * O anual é um produto de CHECKOUT, não um degrau de acesso: PRO_ANNUAL credita
 * PRO. E é sempre avulso — o PreApproval do Mercado Pago não parcela, e o "12×"
 * é justamente o que torna o anual vendável.
 *
 * O risco que estes testes travam é de dinheiro, não de tela: quem migra do
 * mensal para o anual tem um preapproval autorizado no MP. Se ele sobreviver à
 * compra, o cliente paga o ano à vista e continua sendo cobrado todo mês.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';

vi.mock('../models/Transaction.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));
vi.mock('../services/paymentService.js', () => ({
  paymentService: { cancelPreapproval: vi.fn() },
}));

const Transaction = (await import('../models/Transaction.js')).default;
const logger = (await import('../config/logger.js')).default;
const { paymentService } = await import('../services/paymentService.js');
const { grantOneTimePeriod, resolvePlanKey } = await import('../services/subscriptionService.js');
const { PLANS, PLAN_CATALOG, ANNUAL_DAYS, checkoutKeyFor } = await import('../config/subscription.js');

const DAY = 86_400_000;

const makeUser = (overrides = {}) => ({
  _id: 'user-1',
  plan: 'ESSENTIAL',
  role: 'USER',
  subscriptionStatus: 'ACTIVE',
  subscriptionType: 'ONE_TIME',
  validUntil: null,
  save: vi.fn().mockResolvedValue(),
  ...overrides,
});

const pay = { gatewayId: 'pay-1', amount: 598.8, method: 'CREDIT_CARD' };

beforeEach(() => {
  vi.clearAllMocks();
  Transaction.create.mockResolvedValue({});
  paymentService.cancelPreapproval.mockResolvedValue(true);
});

describe('Catálogo anual', () => {
  it('cobra o total do período, e o "12x" é só o parcelamento', () => {
    for (const [base, { monthly, annual }] of Object.entries(PLAN_CATALOG)) {
      if (annual === null) continue;
      // O equivalente mensal anunciado no card é annual/12 — precisa fechar
      // exato, senão a vitrine mostra parcela que não soma o total cobrado.
      expect(Number((annual / 12).toFixed(2)) * 12).toBeCloseTo(annual, 2);
      expect(annual, `${base}: anual sem desconto não é oferta`).toBeLessThan(monthly * 12);
    }
  });

  it('monta a chave de checkout a partir do plano base, ciclo e teste', () => {
    expect(checkoutKeyFor('PRO')).toBe('PRO');
    expect(checkoutKeyFor('PRO', { cycle: 'ANNUAL' })).toBe('PRO_ANNUAL');
    expect(checkoutKeyFor('PRO', { test: true })).toBe('PRO_TEST');
    expect(checkoutKeyFor('PRO', { cycle: 'ANNUAL', test: true })).toBe('PRO_ANNUAL_TEST');

    // Toda chave gerada precisa existir na tabela que o MP cobra.
    for (const cycle of ['MONTHLY', 'ANNUAL']) {
      for (const test of [false, true]) {
        expect(PLANS[checkoutKeyFor('ELITE', { cycle, test })]).toBeDefined();
      }
    }
  });
});

describe('Crédito do período anual', () => {
  it('libera 365 dias e credita o plano BASE, não uma chave nova', async () => {
    const user = makeUser({ plan: 'GUEST' });

    const result = await grantOneTimePeriod(user, 'PRO_ANNUAL', pay);

    expect(result.credited).toBe(true);
    expect(user.plan).toBe('PRO');
    expect(user.billingCycle).toBe('ANNUAL');
    expect(Math.round((user.validUntil - Date.now()) / DAY)).toBe(ANNUAL_DAYS);
  });

  it('registra a transação no plano base — o extrato não inventa um plano "PRO_ANNUAL"', async () => {
    await grantOneTimePeriod(makeUser(), 'PRO_ANNUAL', pay);

    expect(Transaction.create).toHaveBeenCalledWith(expect.objectContaining({ plan: 'PRO' }));
    expect(resolvePlanKey('PRO_ANNUAL_TEST')).toBe('PRO');
  });

  it('a variante de teste anual dura os mesmos 365 dias, só o preço cai', async () => {
    const user = makeUser();

    await grantOneTimePeriod(user, 'PRO_ANNUAL_TEST', { ...pay, amount: 0.5 });

    expect(user.plan).toBe('PRO');
    expect(user.billingCycle).toBe('ANNUAL');
    expect(Math.round((user.validUntil - Date.now()) / DAY)).toBe(ANNUAL_DAYS);
  });

  it('soma sobre o que ainda resta, sem descartar dias já pagos', async () => {
    const user = makeUser({ validUntil: new Date(Date.now() + 10 * DAY) });

    await grantOneTimePeriod(user, 'PRO_ANNUAL', pay);

    expect(Math.round((user.validUntil - Date.now()) / DAY)).toBe(ANNUAL_DAYS + 10);
  });

  it('volta a marcar ciclo mensal quando a compra avulsa é mensal', async () => {
    const user = makeUser({ billingCycle: 'ANNUAL' });

    await grantOneTimePeriod(user, 'PRO', { ...pay, amount: 69.9 });

    expect(user.billingCycle).toBe('MONTHLY');
  });
});

describe('Migração mensal → anual: nenhuma cobrança dupla', () => {
  it('cancela no MP a assinatura mensal de quem compra o anual', async () => {
    const user = makeUser({
      subscriptionType: 'RECURRING',
      mpPreapprovalId: 'preapp-9',
      validUntil: new Date(Date.now() + 12 * DAY),
    });

    await grantOneTimePeriod(user, 'PRO_ANNUAL', pay);

    expect(paymentService.cancelPreapproval).toHaveBeenCalledWith('preapp-9');
    expect(user.subscriptionType).toBe('ONE_TIME');
    expect(user.nextBillingDate).toBeUndefined();
  });

  it('entrega o período mesmo se o cancelamento falhar, e grita no log', async () => {
    // O cliente pagou. Segurar o acesso por causa de uma falha nossa pune quem
    // não errou — mas a cobrança indevida precisa ficar visível para alguém agir.
    paymentService.cancelPreapproval.mockRejectedValue(new Error('MP fora do ar'));
    const user = makeUser({ subscriptionType: 'RECURRING', mpPreapprovalId: 'preapp-9' });

    const result = await grantOneTimePeriod(user, 'PRO_ANNUAL', pay);

    expect(result.credited).toBe(true);
    expect(user.plan).toBe('PRO');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('cobrança dupla'),
      expect.objectContaining({ preapprovalId: 'preapp-9' }),
    );
  });

  it('registra erro quando o MP recusa o cancelamento sem lançar', async () => {
    paymentService.cancelPreapproval.mockResolvedValue(false);
    const user = makeUser({ subscriptionType: 'RECURRING', mpPreapprovalId: 'preapp-9' });

    await grantOneTimePeriod(user, 'PRO_ANNUAL', pay);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('NÃO cancelado'),
      expect.objectContaining({ preapprovalId: 'preapp-9' }),
    );
  });

  it('não tenta cancelar quem nunca teve assinatura recorrente', async () => {
    await grantOneTimePeriod(makeUser(), 'PRO_ANNUAL', pay);

    expect(paymentService.cancelPreapproval).not.toHaveBeenCalled();
  });

  it('não cancela de novo uma assinatura já cancelada', async () => {
    const user = makeUser({ mpPreapprovalId: 'preapp-9', subscriptionStatus: 'CANCELED' });

    await grantOneTimePeriod(user, 'PRO_ANNUAL', pay);

    expect(paymentService.cancelPreapproval).not.toHaveBeenCalled();
  });

  it('reentrega do mesmo pagamento não dispara um segundo cancelamento', async () => {
    // A barreira de idempotência (índice único em gatewayId) vem ANTES do
    // cancelamento — o MP entrega a mesma cobrança por mais de um tópico.
    Transaction.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    const user = makeUser({ subscriptionType: 'RECURRING', mpPreapprovalId: 'preapp-9' });

    const result = await grantOneTimePeriod(user, 'PRO_ANNUAL', pay);

    expect(result).toEqual({ credited: false, duplicated: true });
    expect(paymentService.cancelPreapproval).not.toHaveBeenCalled();
  });
});
