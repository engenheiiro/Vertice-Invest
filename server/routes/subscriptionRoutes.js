
import express from 'express';
import { createCheckoutSession, createTestCheckoutSession, getSubscriptionStatus, checkAccess, registerUsage, handlePaymentReturn, syncPayment } from '../controllers/subscriptionController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import validate from '../middleware/validateResource.js';
import {
  accessFeatureSchema,
  checkoutSchema,
  syncPaymentSchema,
  testCheckoutSchema,
  usageFeatureSchema,
} from '../schemas/subscriptionSchemas.js';

const router = express.Router();

// --- ROTA PÚBLICA DE RETORNO ---
router.get('/return', handlePaymentReturn);

// --- BARREIRA DE SEGURANÇA ---
router.use(authenticateToken); 

// --- ROTAS PROTEGIDAS ---
router.post('/checkout', validate(checkoutSchema), createCheckoutSession);
router.post('/test-checkout', requireAdmin, validate(testCheckoutSchema), createTestCheckoutSession);
router.post('/sync-payment', validate(syncPaymentSchema), syncPayment); // Nova rota de sincronização forçada
router.get('/status', getSubscriptionStatus);

// Controle de Limites
router.get('/check-access', validate(accessFeatureSchema), checkAccess);
router.post('/register-usage', validate(usageFeatureSchema), registerUsage);

export default router;
