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

// Rotas
import authRoutes from './routes/authRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(__filename)); // Sobe um nível para raiz do projeto

const app = express();

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

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173', 
  credentials: true 
}));

// Logger de Requisições HTTP
app.use((req, res, next) => {
    logger.http(`${req.method} ${req.url} - IP: ${req.ip}`);
    next();
});

// --- RATE LIMITING ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,
  message: { message: 'Muitas requisições. Tente novamente mais tarde.' },
  handler: (req, res, next, options) => {
      logger.warn(`Rate Limit Exceeded: ${req.ip}`);
      res.status(options.statusCode).send(options.message);
  }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Muitas tentativas de acesso. Aguarde.' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);

// --- ROTAS DA API ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.use('/api', authRoutes); 
app.use('/api/subscription', subscriptionRoutes);

// --- SERVIR FRONTEND ---
const distPath = path.join(__dirname, 'dist');

// Middleware Sentry Error Handler
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.get('/', (req, res, next) => {
    if (fs.existsSync(path.join(distPath, 'index.html'))) {
        next(); 
    } else {
        res.send('API Vértice Invest Online 🚀 (Backend Operacional).');
    }
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// --- TRATAMENTO DE ERROS GLOBAL ---
app.use((err, req, res, next) => {
  if (!process.env.SENTRY_DSN) {
      logger.error(err.stack);
  } else {
      logger.error(`Erro capturado pelo Sentry: ${err.message}`);
  }

  res.status(500).json({ 
    message: "Ocorreu um erro interno no servidor.",
    errorId: res.sentry 
  });
});

app.get(/.*/, (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("API Online. Frontend não encontrado.");
  }
});

export default app;