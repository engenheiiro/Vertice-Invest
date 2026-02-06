
import express from 'express';
import rateLimit from 'express-rate-limit';
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
    getCashFlow,
    runCorporateAction
} from '../controllers/walletController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// --- RATE LIMITER ESTRITO PARA ESCRITA ---
// Previne ataques de negação de serviço e spam de transações
const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 50, // Limite de 50 operações de escrita por IP
    message: { message: "Muitas operações de escrita. Aguarde 15 minutos." },
    standardHeaders: true,
    legacyHeaders: false,
});

router.use(authenticateToken);

router.get('/', getWalletData);
router.get('/history', getWalletHistory);
router.get('/search', searchAssets);

// Rotas de Escrita Protegidas
router.post('/add', writeLimiter, addAssetTransaction);
router.post('/reset', writeLimiter, resetWallet);
router.delete('/:id', writeLimiter, removeAsset);

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

export default router;
