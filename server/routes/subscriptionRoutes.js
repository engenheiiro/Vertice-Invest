
import express from 'express';
import { createCheckoutSession, createTestCheckoutSession, getSubscriptionStatus, checkAccess, registerUsage, handlePaymentReturn, syncPayment } from '../controllers/subscriptionController.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// --- ROTA PÚBLICA DE RETORNO ---
router.get('/return', handlePaymentReturn);

// --- BARREIRA DE SEGURANÇA ---
router.use(authenticateToken); 

// --- ROTAS PROTEGIDAS ---
router.post('/checkout', createCheckoutSession);
router.post('/test-checkout', requireAdmin, createTestCheckoutSession);
router.post('/sync-payment', syncPayment); // Nova rota de sincronização forçada
router.get('/status', getSubscriptionStatus);

// Controle de Limites
router.get('/check-access', checkAccess);
router.post('/register-usage', registerUsage);

export default router;
