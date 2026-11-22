import { describe, it, expect } from 'vitest';
import { buildSubscriptionView } from './subscriptionCardView';

// Relógio fixo passado como argumento: a contagem de dias nunca depende de hoje.
const NOW = new Date('2026-11-18T14:00:00-03:00').getTime();
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe('buildSubscriptionView', () => {
  it('sem usuário (ou plano desconhecido) é o plano gratuito, sem validade nem cancelamento', () => {
    for (const user of [null, { plan: 'XYZ' as never }]) {
      const v = buildSubscriptionView(user, NOW);
      expect(v.plan).toBe('GUEST');
      expect(v.isPaidPlan).toBe(false);
      expect(v.validity).toBeNull();
      expect(v.canCancel).toBe(false);
      expect(v.status.label).toBe('Inativo');
      expect(v.upgradeLabel).toBe('Fazer Upgrade');
      expect(v.paymentLabel).toBe('Mercado Pago (Pré-pago)');
    }
  });

  it('avulso perto de vencer: selo de expiração urgente e convite para a recorrência', () => {
    const v = buildSubscriptionView({ plan: 'PRO', subscriptionStatus: 'ACTIVE', subscriptionType: 'ONE_TIME', validUntil: inDays(2), paymentMethod: 'PIX' }, NOW);
    expect(v.expiryBadge?.label).toBe('Expira em 2 dias');
    expect(v.expiryBadge?.classes).toContain('text-red-400');
    expect(v.recurringInvite).toBe('Seu acesso vence em 2 dias');
    expect(v.paymentLabel).toBe('Pix · Mercado Pago');
    expect(v.validity?.renewalValue).toBe('Manual');
  });

  it('selo amarelo entre 4 e 7 dias, singular em 1 dia e "Expirado" no vencido', () => {
    const amarelo = buildSubscriptionView({ plan: 'PRO', validUntil: inDays(5) }, NOW);
    expect(amarelo.expiryBadge?.classes).toContain('text-yellow-400');
    expect(buildSubscriptionView({ plan: 'PRO', validUntil: inDays(1) }, NOW).expiryBadge?.label).toBe('Expira em 1 dia');
    const vencido = buildSubscriptionView({ plan: 'PRO', validUntil: inDays(-1) }, NOW);
    expect(vencido.expiryBadge?.label).toBe('Expirado');
    expect(vencido.recurringInvite).toBeNull();
    expect(buildSubscriptionView({ plan: 'PRO', validUntil: inDays(30) }, NOW).expiryBadge).toBeNull();
  });

  it('recorrente ativa renova: sem contagem regressiva, com a data da próxima cobrança', () => {
    const v = buildSubscriptionView({
      plan: 'PRO', subscriptionStatus: 'ACTIVE', subscriptionType: 'RECURRING',
      validUntil: inDays(2), nextBillingDate: '2026-11-21T12:00:00Z', cardBrand: 'master', billingCycle: 'ANNUAL',
    }, NOW);
    expect(v.isRenewing).toBe(true);
    expect(v.expiryBadge).toBeNull();
    expect(v.recurringInvite).toBeNull();
    expect(v.showAnnual).toBe(false);
    expect(v.validity).toMatchObject({ renewalTitle: 'Próxima cobrança', renewalValue: '21/11/2026', renewalTone: 'text-slate-300' });
    expect(v.paymentLabel).toBe('Cartão de Crédito (master) · Assinatura');
    expect(v.canCancel).toBe(true);
  });

  it('anual não recorrente avisa os 12 meses; cancelada mostra "Cancelada"', () => {
    const v = buildSubscriptionView({ plan: 'ELITE', subscriptionStatus: 'CANCELED', validUntil: inDays(200), billingCycle: 'ANNUAL' }, NOW);
    expect(v.showAnnual).toBe(true);
    expect(v.validity?.renewalValue).toBe('Cancelada');
    expect(v.status.label).toBe('Cancelado');
  });

  it('cobrança recusada na recorrência acende o alerta', () => {
    const v = buildSubscriptionView({ plan: 'PRO', subscriptionStatus: 'PAST_DUE', subscriptionType: 'RECURRING', validUntil: inDays(1) }, NOW);
    expect(v.showPaymentFailed).toBe(true);
    expect(v.status.label).toBe('Pendente');
  });

  it('período de teste tem rótulo próprio de pagamento', () => {
    expect(buildSubscriptionView({ plan: 'ESSENTIAL', subscriptionStatus: 'TRIAL' }, NOW).paymentLabel).toBe('Período de Testes');
  });

  it('Black: estilo dourado e sem oferta de upgrade', () => {
    const v = buildSubscriptionView({ plan: 'BLACK', subscriptionStatus: 'ACTIVE' }, NOW);
    expect(v.isBlack).toBe(true);
    expect(v.style.check).toBe('text-gold');
    expect(v.pulseDot).toBe(true);
  });

  it('mensagem de cancelamento cita o plano e a validade quando houver', () => {
    expect(buildSubscriptionView({ plan: 'PRO', validUntil: '2026-12-01T12:00:00Z' }, NOW).cancelMessage).toMatch(/até 01\/12\/2026/);
    expect(buildSubscriptionView({ plan: 'PRO' }, NOW).cancelMessage).toBe('Não haverá novas cobranças. Você mantém o acesso até o fim do período já pago.');
  });
});
