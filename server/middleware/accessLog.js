
import { performance } from 'perf_hooks';
import logger from '../config/logger.js';
import { recordHttpMetric, fullRequestPath } from '../utils/performanceMetrics.js';

// Probes e documentação: alto volume, zero informação de negócio.
const isNoise = (path) => path === '/api/health' || path.startsWith('/api/docs');

/**
 * (D12) Log de conclusão da requisição — método, rota, status e duração, no nível
 * `http`. Sai em desenvolvimento e fica silencioso em produção (o nível do logger
 * lá é `info`, que não alcança `http`).
 *
 * Loga o caminho da ROTA, NUNCA `req.originalUrl`: a query string crua é entrada do
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
    // `fullRequestPath`, não `req.path`: aqui dentro do `finish` o Express já
    // aparou o prefixo do router (ver o helper). Com o caminho cortado, a linha
    // saía como "GET /performance 200" — sem o `/api/wallet` que diz de qual
    // rota se fala — e o filtro de ruído deixava de reconhecer `/api/docs`, que
    // é montado e portanto chega aqui como "/" ou "/swagger-ui.css".
    const caminho = fullRequestPath(req);
    if (isNoise(caminho)) return;
    const durationMs = performance.now() - start;
    recordHttpMetric(req, res.statusCode, durationMs);
    const meta = { ms: Math.round(durationMs) };
    if (req.walletId) meta.walletId = req.walletId;
    logger.http(`${req.method} ${caminho} ${res.statusCode}`, meta);
  });
  next();
};

export default accessLog;
