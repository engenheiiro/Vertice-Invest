import { z } from 'zod';
import { LIMITS_CONFIG, PLANS } from '../config/subscription.js';

const feature = z.enum(Object.keys(LIMITS_CONFIG));

export const checkoutSchema = z.object({
  body: z.object({ planId: z.enum(Object.keys(PLANS)) }).strict(),
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
