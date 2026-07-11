
import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { walletWriteLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validateResource.js';
import {
    listWallets,
    createWallet,
    renameWallet,
    deleteWallet,
    setActiveWallet,
} from '../controllers/walletsController.js';
import {
    createWalletSchema,
    renameWalletSchema,
    walletIdParamSchema,
    setActiveWalletSchema,
} from '../schemas/walletsSchemas.js';

const router = express.Router();

// CRUD da entidade Carteira (Fase 2 — múltiplas carteiras). Distinto de
// /api/wallet (singular), que cuida de ativos/transações/metas-alvo de UMA
// carteira já resolvida via middleware resolveWallet.
router.use(authenticateToken);

const writeLimiter = walletWriteLimiter;

router.get('/', listWallets);
router.post('/', writeLimiter, validate(createWalletSchema), createWallet);
// '/active' antes de '/:walletId' para não cair no matcher de param.
router.put('/active', writeLimiter, validate(setActiveWalletSchema), setActiveWallet);
router.put('/:walletId', writeLimiter, validate(renameWalletSchema), renameWallet);
router.delete('/:walletId', writeLimiter, validate(walletIdParamSchema), deleteWallet);

export default router;
