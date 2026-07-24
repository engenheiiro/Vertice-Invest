import { z } from 'zod';
import { LIMITS_CONFIG, PUBLIC_PLAN_KEYS } from '../config/subscription.js';

const feature = z.enum(Object.keys(LIMITS_CONFIG));

// Só planos vendáveis: as variantes _TEST (R$0,50) entram exclusivamente pelo
// /test-checkout, que é requireAdmin.
export const checkoutSchema = z.object({
  body: z.object({ planId: z.enum(PUBLIC_PLAN_KEYS) }).strict(),
});

export const testCheckoutSchema = z.object({
  body: z.object({ planKey: z.enum(['ESSENTIAL', 'PRO', 'ELITE', 'BLACK']) }).strict(),
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
