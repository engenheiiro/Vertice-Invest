
import express from 'express';
import { createCheckoutSession, confirmPayment, getSubscriptionStatus, checkAccess, registerUsage, handlePaymentReturn } from '../controllers/subscriptionController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// --- ROTA PÚBLICA DE RETORNO (CRÍTICO: DEVE VIR ANTES DO AUTH) ---
// O Mercado Pago redireciona para cá sem cabeçalhos de autenticação.
// Esta rota apenas processa os parâmetros e redireciona o usuário para o Frontend.
router.get('/return', handlePaymentReturn);

// --- BARREIRA DE SEGURANÇA ---
router.use(authenticateToken); 

// --- ROTAS PROTEGIDAS (Abaixo daqui, precisa de Token) ---
router.post('/checkout', createCheckoutSession);
router.post('/confirm', confirmPayment);
router.get('/status', getSubscriptionStatus);

// Controle de Limites
router.get('/check-access', checkAccess);
router.post('/register-usage', registerUsage);

export default router;
