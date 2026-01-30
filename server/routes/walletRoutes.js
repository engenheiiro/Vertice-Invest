
import express from 'express';
import { getWalletData, getWalletHistory, addAssetTransaction, removeAsset, searchAssets, resetWallet } from '../controllers/walletController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/', getWalletData);
router.get('/history', getWalletHistory);
router.get('/search', searchAssets);
router.post('/add', addAssetTransaction);
router.post('/reset', resetWallet); // Nova rota de reset
router.delete('/:id', removeAsset);

export default router;
