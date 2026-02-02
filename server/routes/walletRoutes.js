
import express from 'express';
import { 
    getWalletData, 
    getWalletHistory, 
    addAssetTransaction, 
    removeAsset, 
    searchAssets, 
    resetWallet,
    getAssetTransactions,
    deleteTransaction,
    getWalletPerformance, 
    getWalletDividends,
    getCashFlow // Nova Importação
} from '../controllers/walletController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/', getWalletData);
router.get('/history', getWalletHistory);
router.get('/search', searchAssets);
router.post('/add', addAssetTransaction);
router.post('/reset', resetWallet);
router.delete('/:id', removeAsset);

// Rotas de Transações Granulares
router.get('/transactions/:ticker', getAssetTransactions);
router.delete('/transactions/:id', deleteTransaction);

// Rotas de Inteligência
router.get('/performance', getWalletPerformance);
router.get('/dividends', getWalletDividends);

// Nova Rota: Extrato de Conta Corrente (Cash Flow)
router.get('/cashflow', getCashFlow);

export default router;
