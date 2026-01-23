
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Inicializa CRON Jobs
initScheduler();

// --- CONFIGURAÇÃO SENTRY ---
if (process.env.SENTRY_DSN) {
    Sentry.addIntegration(Sentry.expressIntegration({ app }));
}

// --- MIDDLEWARES DE SEGURANÇA ---
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

// Configuração de CORS Dinâmica
app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origem (como apps mobile ou curl)
    if (!origin) return callback(null, true);

    // Em produção, verifica whitelist estrita
    if (process.env.NODE_ENV === 'production') {
        const allowedOrigins = [process.env.CLIENT_URL].filter(Boolean);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    }

    // Em desenvolvimento, permite qualquer localhost (5173, 5174, etc)
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true 
}));

app.use((req, res, next) => {
    logger.http(`${req.method} ${req.url} - IP: ${req.ip}`);
    next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,
  message: { message: 'Muitas requisições. Tente novamente mais tarde.' }
});

app.use('/api/', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Registro de Rotas
app.use('/api', authRoutes); 
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/research', researchRoutes);

// --- SERVIR FRONTEND ---
// Localiza o dist do client de forma resiliente
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
    res.send('Vértice Invest API Ativa 🚀 | Frontend aguardando build.');
  });
}

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.use((err, req, res, next) => {
  logger.error(`Erro: ${err.message}`);
  res.status(500).json({ 
    message: "Ocorreu um erro interno no servidor.",
    errorId: res.sentry 
  });
});

export default app;
