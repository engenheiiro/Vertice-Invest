
import express from 'express';
import { getHistoricalPrice, getAssetStatus, getLandingData } from '../controllers/marketController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Rota Pública (Landing Page)
router.get('/landing', getLandingData);

// Rotas Protegidas
router.use(authenticateToken); 

// GET /api/market/price?ticker=PETR4&date=2020-01-01&type=STOCK
router.get('/price', getHistoricalPrice);

// GET /api/market/status/PETR4 (Para debug e admin panel)
router.get('/status/:ticker', getAssetStatus);

export default router;
