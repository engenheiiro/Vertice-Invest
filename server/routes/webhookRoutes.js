
import express from 'express';
import { handleMercadoPagoWebhook } from '../controllers/webhookController.js';

const router = express.Router();

// Rota POST pública para o Mercado Pago
router.post('/mercadopago', handleMercadoPagoWebhook);

export default router;
