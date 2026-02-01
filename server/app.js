
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- CORREÇÃO RENDER / PROXY ---
// Necessário para apps rodando atrás de Load Balancers (Render, Heroku, AWS, Nginx)
// Isso resolve o erro ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
app.set('trust proxy', 1);

initScheduler();

if (process.env.SENTRY_DSN) {
    Sentry.addIntegration(Sentry.expressIntegration({ app }));
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], 
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://*.unsplash.com"],
      connectSrc: ["'self'", process.env.SENTRY_DSN ? "https://*.sentry.io" : ""],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());
app.use(cookieParser()); 
app.use(express.json({ limit: '10kb' }));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV === 'production') {
        const allowedOrigins = [process.env.CLIENT_URL].filter(Boolean);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(null, true); // Relaxado para evitar bloqueios indevidos em configs mistas
    }
    return callback(null, true);
  },
  credentials: true 
}));

// --- CONFIGURAÇÃO DE RATE LIMIT AJUSTADA ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 3000, // AUMENTADO DE 150 PARA 3000 (Evita erro 429 em Dev/Uso Intenso)
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Limite de requisições excedido. Aguarde alguns minutos.' }
});

app.use('/api/', apiLimiter);

app.use('/api', authRoutes); 
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/market', marketRoutes);

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
