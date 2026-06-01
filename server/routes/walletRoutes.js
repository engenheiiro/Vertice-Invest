
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
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// (I5) Escrita limitada por USUÁRIO (50/15min) — ver middleware/rateLimiters.js.
// authenticateToken roda antes, então req.user.id está garantido na chave.
const writeLimiter = walletWriteLimiter;

router.use(authenticateToken);

router.get('/', getWalletData);
router.get('/history', getWalletHistory);
router.get('/search', searchAssets);

// Rotas de Escrita Protegidas
router.post('/add', writeLimiter, addAssetTransaction);
router.post('/reset', writeLimiter, resetWallet);
router.delete('/:id', writeLimiter, removeAsset);
router.put('/:id', writeLimiter, updateAsset); 

// Rotas de Transações Granulares
router.get('/transactions/:ticker', getAssetTransactions);
router.delete('/transactions/:id', writeLimiter, deleteTransaction);

// Rotas de Inteligência
router.get('/performance', getWalletPerformance);
router.get('/dividends', getWalletDividends);

// Extrato de Conta Corrente (Cash Flow)
router.get('/cashflow', getCashFlow);

// Nova Rota: Correção de Splits (Admin / Manutenção)
router.post('/fix-splits', writeLimiter, runCorporateAction);

// Rotas Admin de Saúde
router.post('/fix-snapshots', requireAdmin, fixWalletSnapshots);
router.get('/snapshot-health', requireAdmin, getSnapshotHealth);
// NOVO: Trigger Manual de Snapshot
router.post('/admin/snapshot/force', requireAdmin, forceSnapshot);

export default router;
