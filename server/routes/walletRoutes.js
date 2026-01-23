import express from 'express';
import { getWalletData, addAssetTransaction, removeAsset } from '../controllers/walletController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/', getWalletData);
router.post('/add', addAssetTransaction);
router.delete('/:id', removeAsset);

export default router;