
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import * as Sentry from "@sentry/node";
import { fileURLToPath } from 'url';
import logger from './config/logger.js';
import { initScheduler } from './services/schedulerService.js';

// Rotas
import authRoutes from './routes/authRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import researchRoutes from './routes/researchRoutes.js';
import walletRoutes from './routes/walletRoutes.js';
import marketRoutes from './routes/marketRoutes.js'; 
import webhookRoutes from './routes/webhookRoutes.js'; // Nova Rota
import academyRoutes from './routes/academyRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- CORREÇÃO RENDER / PROXY ---
app.set('trust proxy', 1);

initScheduler();

if (process.env.SENTRY_DSN) {
    Sentry.addIntegration(Sentry.expressIntegration({ app }));
}

app.use(helmet({
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://www.mercadopago.com.br", "https://sdk.mercadopago.com", "https://secure.mlstatic.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://*.unsplash.com", "https://http2.mlstatic.com"],
      connectSrc: ["'self'", ...(process.env.SENTRY_DSN ? ["https://*.sentry.io"] : []), "https://api.mercadopago.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());
app.use(cookieParser()); 
app.use(express.json({ limit: '10kb' }));

const ALLOWED_ORIGINS = [process.env.CLIENT_URL, 'http://localhost:5173'].filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origem não permitida por CORS'));
  },
  credentials: true
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas tentativas. Tente novamente em 15 minutos.' },
});

app.use('/api/', apiLimiter);
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);
app.use('/api/forgot-password', authLimiter);
app.use('/api/reset-password', authLimiter);
app.use('/api/refresh', authLimiter);

app.use('/api', authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/webhooks', webhookRoutes); // Registro dos Webhooks
app.use('/api/academy', academyRoutes);

const distPath = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
} else {
  app.get('/', (req, res) => {
    res.send('Vértice Invest API Ativa 🚀');
  });
}

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.use((err, req, res, next) => {
  logger.error(`Erro: ${err.message}`);
  res.status(err.status || 500).json({ message: err.message || "Erro interno no servidor." });
});

export default app;
