
import { performance } from 'perf_hooks';
import logger from '../config/logger.js';
import { recordHttpMetric } from '../utils/performanceMetrics.js';

// Probes e documentação: alto volume, zero informação de negócio.
const isNoise = (path) => path === '/api/health' || path.startsWith('/api/docs');

/**
 * (D12) Log de conclusão da requisição — método, rota, status e duração, no nível
 * `http`. Sai em desenvolvimento e fica silencioso em produção (o nível do logger
 * lá é `info`, que não alcança `http`).
 *
 * Loga `req.path`, NUNCA `req.originalUrl`: a query string crua é entrada do
 * cliente e cairia em texto puro no console e — se alguém subir o nível para
 * `debug` para depurar algo em produção — dentro de `combined.log`/`combined.json.log`,
 * que rotacionam e ficam em disco. Hoje só trafega `walletId` ali, mas basta uma
 * rota futura aceitar `?token=`/`?email=` para virar vazamento. Pelo mesmo motivo
 * o escopo de carteira sai de `req.walletId` (id já resolvido e validado por
 * `resolveWallet`) e não de `req.query.walletId`, que é texto arbitrário e
 * permitiria forjar linhas de log com quebra de linha.
 *
 * Duração e carteira vão como metadados estruturados: viram campos pesquisáveis
 * no transport JSON em vez de pedaços de string.
 */
export const accessLog = (req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    if (isNoise(req.path)) return;
    const durationMs = performance.now() - start;
    recordHttpMetric(req, res.statusCode, durationMs);
    const meta = { ms: Math.round(durationMs) };
    if (req.walletId) meta.walletId = req.walletId;
    logger.http(`${req.method} ${req.path} ${res.statusCode}`, meta);
  });
  next();
};

export default accessLog;
