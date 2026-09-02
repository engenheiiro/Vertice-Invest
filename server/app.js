
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
import { sanitizeInput } from './middleware/sanitize.js'; // (S8) anti-injeção NoSQL
import { correlationId } from './middleware/correlationId.js'; // (D12) correlation id
import { accessLog } from './middleware/accessLog.js'; // (D12) log de request concluída
import { csrfProtection } from './middleware/csrf.js'; // (1.4) CSRF double-submit
import { collectShellScriptHashes, isStaticAssetPath } from './utils/staticShell.js';
import { errorHandler } from './middleware/errorHandler.js'; // (6.1) erro estruturado
import { productionErrorSanitizer } from './middleware/productionErrorSanitizer.js';
import { mongoCircuitBreaker, getMongoBreakerState } from './middleware/mongoCircuitBreaker.js'; // (6.9) disjuntor do MongoDB
import { swaggerSpec } from './config/swagger.js'; // (I7) OpenAPI/Swagger
import logger from './config/logger.js';
import AppError from './utils/AppError.js';
import { buildAllowedOrigins, resolveCorsOrigin, sanitizeOriginForLog } from './utils/corsOrigins.js';

// Rotas
import authRoutes from './routes/authRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import researchRoutes from './routes/researchRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import walletRoutes from './routes/walletRoutes.js';
import walletsRoutes from './routes/walletsRoutes.js';
import goalsRoutes from './routes/goalsRoutes.js';
import marketRoutes from './routes/marketRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js'; // Nova Rota
import academyRoutes from './routes/academyRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import publicRoutes from './routes/publicRoutes.js';
import sitemapRouter from './routes/sitemapRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- CORREÇÃO RENDER / PROXY ---
app.set('trust proxy', 1);

// (D12) Primeiro middleware: atribui/propaga o correlation id para toda a
// cadeia (logs e header de resposta). Precisa vir antes de tudo.
app.use(correlationId);
app.use(productionErrorSanitizer);

// (D12) Log de conclusão da requisição (método, rota, status, duração) no nível
// `http` — sai em dev, silencioso em produção. Pula probes/docs para não poluir.
app.use(accessLog);

if (process.env.SENTRY_DSN) {
    Sentry.addIntegration(Sentry.expressIntegration({ app }));
}

// (I7) Documentação interativa da API em /api/docs. Montada ANTES do helmet
// porque a Swagger UI usa scripts/estilos inline que a CSP estrita bloquearia.
// Também expõe o JSON cru do spec em /api/docs.json para tooling.
// (F7) Fora de produção por padrão: expor toda a superfície da API a não
// autenticados é divulgação desnecessária. ENABLE_API_DOCS=true reabilita se
// preciso (ex.: ambiente de staging com acesso restrito).
if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true') {
  app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customSiteTitle: 'Vértice Invest API' }));
}

// Caminho do shell buildado. Declarado aqui em cima porque a CSP abaixo precisa
// ler os HTML do build para autorizar os scripts inline do próprio app.
const distPath = path.resolve(__dirname, '../client/dist');

// Scripts inline que o shell realmente executa: anti-FOUC de tema, GA4 e a
// auto-recuperação de build velho. Sem estes hashes o navegador bloqueia os três
// — foi o que aconteceu em produção: o Analytics nunca registrou um evento e o
// anti-FOUC nunca rodou (flash escuro em quem usa tema claro).
//
// Hash e não nonce: o service worker precacheia o index.html, então um nonce por
// request seria servido do cache com valor velho e a CSP bloquearia igual.
const shellScriptHashes = collectShellScriptHashes(distPath);

app.use(helmet({
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://www.mercadopago.com.br",
        "https://sdk.mercadopago.com",
        "https://secure.mlstatic.com",
        "https://www.googletagmanager.com", // GA4 (gtag.js)
        ...shellScriptHashes,
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://*.unsplash.com", "https://http2.mlstatic.com", "https://www.googletagmanager.com", "https://*.google-analytics.com"],
      // GA4 manda os eventos por fetch/beacon: sem estes o gtag carrega e mede nada.
      connectSrc: [
        "'self'",
        ...(process.env.SENTRY_DSN ? ["https://*.sentry.io"] : []),
        "https://api.mercadopago.com",
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://*.googletagmanager.com",
      ],
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

// CORS por delegate (recebe `req`) e NUNCA por exceção. Origem desconhecida não
// é defeito do servidor: antes o callback lançava `Error`, o errorHandler global
// devolvia 500 e o painel de Saúde enchia de "Origem não permitida por CORS" sem
// dizer qual origem era. Pior: script de módulo do Vite (`crossorigin`) e POST
// mandam `Origin` mesmo na MESMA origem, então quem abrisse o app por um endereço
// diferente do `CLIENT_URL` exato (www, `*.onrender.com`, `localhost:5000`
// servindo o dist) levava 500 no bundle — tela branca — e no `/api/refresh`.
//
// A negação agora é a do próprio protocolo: não emitir `Access-Control-Allow-*`.
// O navegador bloqueia a leitura da resposta; CSRF continua coberto pelo
// double-submit de `middleware/csrf.js`, que não depende disto.
const ALLOWED_ORIGINS = buildAllowedOrigins(process.env);
const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-CSRF-Token'];

app.use(cors((req, callback) => {
  const selfOrigin = `${req.protocol}://${req.get('host') || ''}`;
  const decision = resolveCorsOrigin({
    origin: req.headers.origin,
    selfOrigin,
    allowed: ALLOWED_ORIGINS,
    isProduction: process.env.NODE_ENV === 'production',
  });
  req.corsDenied = !decision.allowed;
  callback(null, {
    // `true` reflete a origem da requisição (obrigatório com credentials);
    // `false` só omite os headers — a requisição segue e o navegador decide.
    origin: decision.allowed,
    credentials: true,
    // (1.4) Libera o header CSRF no preflight (as mutações já são preflighted
    // por usarem Content-Type: application/json).
    allowedHeaders: CORS_ALLOWED_HEADERS,
  });
}));

// Origem negada: 403 explícito nas rotas de API (sinal limpo, `warn` no log, não
// entra no painel como erro interno) e passagem livre para o shell/estático —
// derrubar o `index.html` por causa de um header de origem é o bug que se está
// consertando aqui. A origem vai sanitizada: entrada de cliente em linha de log
// forja registro.
app.use((req, res, next) => {
  if (!req.corsDenied) return next();
  logger.warn('CORS: origem bloqueada', {
    origin: sanitizeOriginForLog(req.headers.origin),
    method: req.method,
    path: req.path,
  });
  if (!req.path.startsWith('/api')) return next();
  return next(new AppError('Origem não permitida.', { status: 403, code: 'CORS_ORIGIN_DENIED' }));
});

// Respostas da API podem conter dados pessoais, financeiros ou de sessão. A PWA
// já usa NetworkOnly, mas este header também impede caches de navegador, proxy e
// CDN. Rotas públicas explicitamente seguras para cache podem sobrescrevê-lo.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

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
app.use('/api/admin', adminRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/wallets', walletsRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/webhooks', webhookRoutes); // Registro dos Webhooks
app.use('/api/academy', academyRoutes);
app.use('/api/notifications', notificationRoutes);
// (C4) Rota pública de carteira — sem auth (o próprio router aplica o limiter por IP).
app.use('/api/public', publicRoutes);

app.use(sitemapRouter);

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
    // Rota de API inexistente responde 404 — antes caía aqui e a requisição
    // ficava pendurada até o timeout do cliente, sem status e sem log de erro.
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Rota não encontrada' });
    }
    // ARQUIVO que não existe no build é 404, nunca o shell. Devolver index.html
    // com 200 para /assets/algo.js entrega HTML onde o navegador esperava um
    // módulo ("Expected a JavaScript-or-Wasm module script but the server
    // responded with a MIME type of text/html") e trava o app inteiro num erro
    // que não diz o que aconteceu. É também o 404 que a auto-recuperação do
    // index.html usa para saber que o shell em cache está velho.
    if (isStaticAssetPath(req.path)) {
      return res.status(404).type('text/plain').send('Not Found');
    }
    // O shell SPA nunca deve ser cacheado sem revalidação, senão referencia chunks antigos.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'index.html'));
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
