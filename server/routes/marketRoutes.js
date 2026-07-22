
import express from 'express';
import { getHistoricalPrice, getAssetStatus, getLandingData, getCurrentQuote, getAssetLogo } from '../controllers/marketController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { publicLogoLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();

// Rota Pública (Landing Page)
router.get('/landing', getLandingData);

// GET /api/market/logo/PETR4?type=STOCK — PÚBLICA: <img> não envia JWT.
// Serve a logo cacheada no BD (busca-e-cacheia na 1ª vez); 404 → front usa iniciais.
router.get('/logo/:ticker', publicLogoLimiter, getAssetLogo);

// Rotas Protegidas
router.use(authenticateToken); 

// GET /api/market/price?ticker=PETR4&date=2020-01-01&type=STOCK (HISTÓRICO)
router.get('/price', getHistoricalPrice);

// GET /api/market/quote?ticker=PETR4 (ATUAL/LIVE)
router.get('/quote', getCurrentQuote);

// GET /api/market/status/PETR4 (Para debug e admin panel)
router.get('/status/:ticker', getAssetStatus);

export default router;
