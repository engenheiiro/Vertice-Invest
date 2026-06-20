
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import * as Sentry from "@sentry/node";
import { fileURLToPath } from 'url';
import swaggerUi from 'swagger-ui-express';
import logger from './config/logger.js';
import { initScheduler } from './services/schedulerService.js';
import { sanitizeInput } from './middleware/sanitize.js'; // (S8) anti-injeção NoSQL
import { correlationId } from './middleware/correlationId.js'; // (D12) correlation id
import { csrfProtection } from './middleware/csrf.js'; // (1.4) CSRF double-submit
import { errorHandler } from './middleware/errorHandler.js'; // (6.1) erro estruturado
import { mongoCircuitBreaker, getMongoBreakerState } from './middleware/mongoCircuitBreaker.js'; // (6.9) disjuntor do MongoDB
import { swaggerSpec } from './config/swagger.js'; // (I7) OpenAPI/Swagger

// Rotas
import authRoutes from './routes/authRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import researchRoutes from './routes/researchRoutes.js';
import walletRoutes from './routes/walletRoutes.js';
import goalsRoutes from './routes/goalsRoutes.js';
import marketRoutes from './routes/marketRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js'; // Nova Rota
import academyRoutes from './routes/academyRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import sitemapRouter from './routes/sitemapRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- CORREÇÃO RENDER / PROXY ---
app.set('trust proxy', 1);

// (D12) Primeiro middleware: atribui/propaga o correlation id para toda a
// cadeia (logs e header de resposta). Precisa vir antes de tudo.
app.use(correlationId);

// (D12) Log de conclusão da requisição (método, rota, status, duração) no nível
// `http` — sai em dev, silencioso em produção. Pula probes/docs para não poluir.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/health' || req.path.startsWith('/api/docs')) return;
    logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

initScheduler();

if (process.env.SENTRY_DSN) {
    Sentry.addIntegration(Sentry.expressIntegration({ app }));
}

// (I7) Documentação interativa da API em /api/docs. Montada ANTES do helmet
// porque a Swagger UI usa scripts/estilos inline que a CSP estrita bloquearia.
// Também expõe o JSON cru do spec em /api/docs.json para tooling.
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customSiteTitle: 'Vértice Invest API' }));

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
// Limite generoso o suficiente para payloads legítimos (ex.: rankings com 100+
// ativos e auditLog completo), mantendo proteção contra corpos abusivos.
app.use(express.json({ limit: '1mb' }));
// (S8) Sanitiza inputs (remove operadores Mongo/prototype pollution das chaves)
// logo após o parse do corpo e antes de qualquer rota.
app.use(sanitizeInput);

const ALLOWED_ORIGINS = [process.env.CLIENT_URL, 'http://localhost:5173'].filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origem não permitida por CORS'));
  },
  credentials: true,
  // (1.4) Libera o header CSRF no preflight (as mutações já são preflighted por
  // usarem Content-Type: application/json).
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

// Health check (liveness/readiness) — antes do rate limiter para não ser
// estrangulado por probes de monitoramento (Render, uptime checks, k8s).
const MONGO_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];
app.get('/api/health', (req, res) => {
  const state = mongoose.connection.readyState;
  const healthy = state === 1;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    mongo: MONGO_STATES[state] ?? 'unknown',
    dbBreaker: getMongoBreakerState().circuit, // (6.9) CLOSED | OPEN | HALF_OPEN
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Mensagem de bloqueio com o tempo REAL restante (não um "15 min" fixo, que
// confundia quem caía no limite por outra rota). `hint` aponta a saída útil.
const buildLimitHandler = (hint = '') => (req, res, _next, options) => {
  const resetTime = req.rateLimit?.resetTime;
  const mins = resetTime
    ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 60000))
    : 15;
  res.status(options.statusCode).json({
    message: `Muitas tentativas. Tente novamente em ${mins} ${mins === 1 ? 'minuto' : 'minutos'}.${hint ? ` ${hint}` : ''}`,
  });
};

// Login: defesa contra força-bruta de senha. Conta APENAS tentativas que
// FALHARAM (skipSuccessfulRequests) — quem acerta a senha não é penalizado;
// quem fica chutando, sim. Bucket próprio, separado da recuperação de conta.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildLimitHandler('Se esqueceu a senha, use "Esqueci minha senha".'),
});

// Cadastro: barra criação em massa a partir de um IP. Conta todas as requisições
// (cadastro bem-sucedido é justamente o que queremos limitar). Bucket próprio
// para que uma rajada de logins falhos não bloqueie quem quer se registrar.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildLimitHandler(),
});

// Recuperação de conta (forgot/reset): bucket SEPARADO do login — falhas de
// login não podem trancar quem está tentando recuperar o acesso. Conta tudo
// (forgot-password responde 200 mesmo p/ e-mail inexistente, por anti-enumeração,
// então pular sucessos abriria espaço p/ spam de e-mail). Limite generoso p/ humano.
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildLimitHandler(),
});

// Renovação de sessão: bucket DEDICADO para não drenar o apiLimiter geral.
// O interceptor do front dispara em cada 401 (pode ter concorrência de tabs),
// por isso o limite é generoso o suficiente para não penalizar uso legítimo,
// mas isola o orçamento de refresh do orçamento compartilhado das demais rotas.
// Força-bruta não é relevante aqui: o refresh token é uma string aleatória longa
// validada no banco — esgotar 120 tentativas em 15min não serve para nada.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildLimitHandler(),
});

app.use('/api/', apiLimiter);
app.use('/api/login', loginLimiter);
app.use('/api/register', registerLimiter);
app.use('/api/forgot-password', recoveryLimiter);
app.use('/api/reset-password', recoveryLimiter);
app.use('/api/refresh', refreshLimiter);

// (1.4) Proteção CSRF (double-submit). Aplicada às mutações autenticadas; as
// rotas de bootstrap de sessão (sem Bearer ainda) e os webhooks servidor-a-
// servidor são isentos. `/login` e `/refresh` EMITEM o token (no controller),
// mas não o exigem como header. Métodos seguros (GET/HEAD) passam direto.
const CSRF_EXEMPT_PREFIXES = [
  '/api/login',
  '/api/register',
  '/api/forgot-password',
  '/api/reset-password',
  '/api/refresh',
  '/api/logout',
  '/api/webhooks',
];
app.use((req, res, next) => {
  if (CSRF_EXEMPT_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
    return next();
  }
  return csrfProtection(req, res, next);
});

// (6.9) Disjuntor do MongoDB: fail-fast 503 nas rotas de dados quando o banco
// está fora, evitando acúmulo de requests presas no timeout. Vem depois do
// /api/health (que precisa responder com o banco fora) e antes das rotas.
app.use('/api', mongoCircuitBreaker);

app.use('/api', authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/webhooks', webhookRoutes); // Registro dos Webhooks
app.use('/api/academy', academyRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(sitemapRouter);

const distPath = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(distPath)) {
  // Cache-Control consciente do build:
  // - index.html / service worker / manifest → no-cache (revalida sempre): o navegador
  //   pega o build novo no próximo request após o deploy (sem ficar preso na versão antiga).
  // - assets com hash no nome (/assets/*) → immutable por 1 ano (o hash muda a cada build).
  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      const base = path.basename(filePath);
      const noRevalidate = ['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest'];
      if (noRevalidate.includes(base)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      // O shell SPA nunca deve ser cacheado sem revalidação, senão referencia chunks antigos.
      res.setHeader('Cache-Control', 'no-cache');
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

// (6.1) Tratador de erros estruturado (código + mensagem + detalhe + requestId).
app.use(errorHandler);

export default app;
