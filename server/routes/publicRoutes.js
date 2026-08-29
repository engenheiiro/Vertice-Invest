import express from 'express';
import { publicShareLimiter } from '../middleware/rateLimiters.js';
import {
    getPublicWallet,
    getPublicWalletHistory,
    getPublicWalletPerformance,
    getPublicWalletDividends,
    getPublicWalletCashFlow,
} from '../controllers/publicWalletController.js';

/**
 * (C4) Rotas PÚBLICAS — sem authenticateToken. Única superfície não-autenticada
 * de dados de carteira, então roda atrás do publicShareLimiter (por IP) e só
 * resolve carteiras com compartilhamento explicitamente ligado (isPublic+token).
 *
 * O conjunto espelha as rotas privadas que a página Carteira consome, porque o
 * link renderiza exatamente aquela página em modo leitura.
 */
const router = express.Router();

router.get('/wallet/:token', publicShareLimiter, getPublicWallet);
router.get('/wallet/:token/history', publicShareLimiter, getPublicWalletHistory);
router.get('/wallet/:token/performance', publicShareLimiter, getPublicWalletPerformance);
router.get('/wallet/:token/dividends', publicShareLimiter, getPublicWalletDividends);
router.get('/wallet/:token/cashflow', publicShareLimiter, getPublicWalletCashFlow);

export default router;
