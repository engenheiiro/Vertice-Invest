
import express from 'express';
import { getWalletData, addAssetTransaction, removeAsset, searchAssets } from '../controllers/walletController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/', getWalletData);
router.get('/search', searchAssets); // Nova rota de busca
router.post('/add', addAssetTransaction);
router.delete('/:id', removeAsset);

export default router;
