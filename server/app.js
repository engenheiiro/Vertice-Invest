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
const __dirname = path.dirname(__filename);

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

// Configuração Dinâmica de CORS
const allowedOrigins = [
  'http://localhost:5173',
  process.env.CLIENT_URL // Permite definir URL do front em produção se necessário
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origem (como apps mobile ou curl) ou se a origem estiver na lista
    // Em produção monolítica (mesmo domínio), a origem muitas vezes é undefined ou igual ao host
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
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

app.use('/api/', apiLimiter);

// --- ROTAS DA API ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', environment: process.env.NODE_ENV, timestamp: new Date() });
});

app.use('/api', authRoutes); 
app.use('/api/subscription', subscriptionRoutes);

// --- SERVIR FRONTEND ---
// Define o caminho para a pasta dist do cliente
const distPath = path.join(__dirname, '../client/dist');

// Verifica se o build existe antes de tentar servir
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  
  // Tratamento SPA: Qualquer rota não-API retorna o index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Fallback se o build não foi rodado
  app.get('/', (req, res) => {
    res.status(500).send(`
      <h1>Erro de Configuração</h1>
      <p>O frontend não foi encontrado em: <code>${distPath}</code></p>
      <p>Certifique-se de rodar <code>npm run build</code> na pasta client antes de iniciar o servidor.</p>
    `);
  });
}

// --- TRATAMENTO DE ERROS GLOBAL ---
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