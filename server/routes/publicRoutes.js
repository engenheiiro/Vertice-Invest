
import express from 'express';
import { publicShareLimiter } from '../middleware/rateLimiters.js';
import { getPublicWallet } from '../controllers/publicWalletController.js';

/**
 * (C4) Rotas PÚBLICAS — sem authenticateToken. Única superfície não-autenticada
 * de dados de carteira, então roda atrás do publicShareLimiter (por IP) e só
 * resolve carteiras com compartilhamento explicitamente ligado (isPublic+token).
 */
const router = express.Router();

router.get('/wallet/:token', publicShareLimiter, getPublicWallet);

export default router;
