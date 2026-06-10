
import express from 'express';
import { walletWriteLimiter } from '../middleware/rateLimiters.js';
import {
    getWalletData,
    getWalletHistory, 
    addAssetTransaction, 
    removeAsset, 
    updateAsset, 
    searchAssets,
    resetWallet,
    updateWalletTargets,
    getAssetTransactions,
    deleteTransaction,
    getWalletPerformance, 
    getWalletDividends,
    getCashFlow,
    runCorporateAction,
    fixWalletSnapshots,
    getSnapshotHealth,
    forceSnapshot // Importado
} from '../controllers/walletController.js';
import { authenticateToken, requireAdmin, requireElitePlan } from '../middleware/authMiddleware.js';
import { researchHeavyLimiter } from '../middleware/rateLimiters.js';
import validate from '../middleware/validateResource.js';
import {
    addTransactionSchema,
    updateAssetSchema,
    idParamSchema,
    corporateActionSchema,
    updateTargetsSchema,
} from '../schemas/walletSchemas.js';
import { rebalanceSchema } from '../schemas/rebalanceSchemas.js';
import { generateRebalancePlan } from '../controllers/rebalanceController.js';

const router = express.Router();

// (I5) Escrita limitada por USUÁRIO (50/15min) — ver middleware/rateLimiters.js.
// authenticateToken roda antes, então req.user.id está garantido na chave.
const writeLimiter = walletWriteLimiter;

router.use(authenticateToken);

router.get('/', getWalletData);
router.get('/history', getWalletHistory);
router.get('/search', searchAssets);

// Rotas de Escrita Protegidas — (I9) validação Zod após limiter, antes do handler.
router.post('/add', writeLimiter, validate(addTransactionSchema), addAssetTransaction);
router.post('/reset', writeLimiter, resetWallet);
// Carteira ideal (alocação-alvo) — antes de '/:id' para não cair no matcher de param.
router.put('/targets', writeLimiter, validate(updateTargetsSchema), updateWalletTargets);
router.delete('/:id', writeLimiter, validate(idParamSchema), removeAsset);
router.put('/:id', writeLimiter, validate(updateAssetSchema), updateAsset);

// Rotas de Transações Granulares
router.get('/transactions/:ticker', getAssetTransactions);
router.delete('/transactions/:id', writeLimiter, validate(idParamSchema), deleteTransaction);

// Rotas de Inteligência
router.get('/performance', getWalletPerformance);
router.get('/dividends', getWalletDividends);

// Rebalanceamento IA (ELITE+): read-only, gera plano de ordens. Cadeia:
// authenticateToken (router.use) → requireElitePlan → limiter pesado → validate → handler.
router.post('/rebalance', requireElitePlan, researchHeavyLimiter, validate(rebalanceSchema), generateRebalancePlan);

// Extrato de Conta Corrente (Cash Flow)
router.get('/cashflow', getCashFlow);

// Nova Rota: Correção de Splits (Admin / Manutenção)
router.post('/fix-splits', writeLimiter, validate(corporateActionSchema), runCorporateAction);

// Rotas Admin de Saúde
router.post('/fix-snapshots', requireAdmin, fixWalletSnapshots);
router.get('/snapshot-health', requireAdmin, getSnapshotHealth);
// NOVO: Trigger Manual de Snapshot
router.post('/admin/snapshot/force', requireAdmin, forceSnapshot);

export default router;
