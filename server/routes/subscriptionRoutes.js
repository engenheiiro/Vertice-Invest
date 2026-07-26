
import express from 'express';
import { createCheckoutSession, createTestCheckoutSession, getSubscriptionStatus, checkAccess, registerUsage, handlePaymentReturn, syncPayment, syncPreapproval, cancelSubscription, changePlan } from '../controllers/subscriptionController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { subscriptionWriteLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validateResource.js';
import {
  accessFeatureSchema,
  changePlanSchema,
  checkoutSchema,
  syncPaymentSchema,
  syncPreapprovalSchema,
  testCheckoutSchema,
  usageFeatureSchema,
} from '../schemas/subscriptionSchemas.js';

const router = express.Router();

// --- ROTAS PÚBLICAS DE RETORNO ---
// /return       → Checkout Pro (avulso), que aceita query string no back_url.
// /return/:plan → PreApproval (recorrente), cujo back_url precisa ser livre de
//                 query string (o MP anexa "?preapproval_id=..." por conta).
router.get('/return', handlePaymentReturn);
router.get('/return/:plan', handlePaymentReturn);

// --- BARREIRA DE SEGURANÇA ---
router.use(authenticateToken); 

// --- ROTAS PROTEGIDAS ---
// Ordem: rateLimiter → authenticateToken (aplicado acima) → requireAdmin → handler.
router.post('/checkout', subscriptionWriteLimiter, validate(checkoutSchema), createCheckoutSession);
router.post('/test-checkout', subscriptionWriteLimiter, requireAdmin, validate(testCheckoutSchema), createTestCheckoutSession);
router.post('/sync-payment', subscriptionWriteLimiter, validate(syncPaymentSchema), syncPayment); // Redundância ao webhook (avulso)
router.post('/sync-preapproval', subscriptionWriteLimiter, validate(syncPreapprovalSchema), syncPreapproval); // Redundância ao webhook (recorrente)
router.post('/cancel', subscriptionWriteLimiter, cancelSubscription);
router.post('/change-plan', subscriptionWriteLimiter, validate(changePlanSchema), changePlan);
router.get('/status', getSubscriptionStatus);

// Controle de Limites
router.get('/check-access', validate(accessFeatureSchema), checkAccess);
router.post('/register-usage', validate(usageFeatureSchema), registerUsage);

export default router;
