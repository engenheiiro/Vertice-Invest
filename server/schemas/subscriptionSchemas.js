import { z } from 'zod';
import { BILLING_CYCLES, BILLING_MODES, LIMITS_CONFIG, PUBLIC_PLAN_KEYS } from '../config/subscription.js';

const feature = z.enum(Object.keys(LIMITS_CONFIG));

// ONE_TIME por padrão: mantém compatível qualquer cliente que ainda não envie o
// modo (o comportamento antigo era sempre avulso).
const mode = z.enum(BILLING_MODES).optional().default('ONE_TIME');

// MONTHLY por padrão: o ciclo é opt-in, então nenhum cliente antigo passa a
// comprar um ano sem pedir.
const cycle = z.enum(BILLING_CYCLES).optional().default('MONTHLY');

// Só planos vendáveis: as variantes _TEST (R$0,50) entram exclusivamente pelo
// /test-checkout, que é requireAdmin.
export const checkoutSchema = z.object({
  body: z.object({ planId: z.enum(PUBLIC_PLAN_KEYS), mode }).strict(),
});

export const testCheckoutSchema = z.object({
  body: z.object({
    planKey: z.enum(['ESSENTIAL', 'PRO', 'ELITE', 'BLACK']),
    mode,
    cycle,
  }).strict(),
});

export const syncPreapprovalSchema = z.object({
  body: z.object({
    preapprovalId: z.string().trim().min(1, 'ID de assinatura é obrigatório.').max(128, 'ID de assinatura inválido.'),
  }).strict(),
});

// Aceita as chaves anuais para o controller poder explicar POR QUE não dá — um
// "enum inválido" do Zod não diria a quem clicou que o caminho é o checkout.
export const changePlanSchema = z.object({
  body: z.object({ planId: z.enum(PUBLIC_PLAN_KEYS) }).strict(),
});

export const syncPaymentSchema = z.object({
  body: z.object({
    paymentId: z.union([
      z.string().trim().min(1, 'ID de pagamento é obrigatório.').max(128, 'ID de pagamento inválido.'),
      z.number().int().positive('ID de pagamento inválido.'),
    ]),
  }).strict(),
});

export const accessFeatureSchema = z.object({
  query: z.object({ feature }),
});

export const usageFeatureSchema = z.object({
  body: z.object({ feature }).strict(),
});
