import express from 'express';
import { createCheckoutSession, confirmPayment, getSubscriptionStatus } from '../controllers/subscriptionController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken); // Todas as rotas requerem login

router.post('/checkout', createCheckoutSession);
router.post('/confirm', confirmPayment);
router.get('/status', getSubscriptionStatus);

export default router;