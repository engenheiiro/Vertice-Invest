
import express from 'express';
import { createCheckoutSession, confirmPayment, getSubscriptionStatus, checkAccess, registerUsage } from '../controllers/subscriptionController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken); // Todas as rotas requerem login

router.post('/checkout', createCheckoutSession);
router.post('/confirm', confirmPayment);
router.get('/status', getSubscriptionStatus);

// Novas Rotas de Controle de Limites
router.get('/check-access', checkAccess);
router.post('/register-usage', registerUsage);

export default router;
