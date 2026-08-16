/**
 * (6.1) Tratador de erros estruturado.
 *
 * Antes o handler global devolvia apenas `{ message }`. Agora a resposta tem
 * formato padronizado:
 *
 *   {
 *     "message": "<humano>",            // compat: clientes antigos leem data.message
 *     "error": {
 *       "code": "BAD_REQUEST",          // legível por máquina
 *       "message": "<humano>",
 *       "details": <opcional>,          // campos inválidos, ids, etc.
 *       "requestId": "<correlation id>" // p/ rastrear nos logs
 *     }
 *   }
 *
 * `buildErrorResponse` é puro (sem efeitos) para ser testável isoladamente:
 * recebe o erro + requestId e devolve `{ status, body }`. O middleware só
 * adiciona logging e escreve a resposta.
 *
 * Compatibilidade: continua honrando `err.status`, `err.statusCode` e o legado
 * `err.httpStatus` (usado por txError/controllers), além de inferir status/code
 * de erros nativos (Mongoose ValidationError/CastError/duplicate key, JWT).
 */
import logger from '../config/logger.js';
import { getRequestId } from '../utils/requestContext.js';
import { STATUS_CODE } from '../utils/AppError.js';
import { recordError } from '../services/errorLogService.js';

// Erros conhecidos de libs → status + code padronizados.
const KNOWN_BY_NAME = {
  ValidationError: { status: 400, code: 'VALIDATION_ERROR' },
  CastError: { status: 400, code: 'INVALID_ID' },
  JsonWebTokenError: { status: 401, code: 'INVALID_TOKEN' },
  TokenExpiredError: { status: 401, code: 'TOKEN_EXPIRED' },
};

export const buildErrorResponse = (err = {}, requestId) => {
  let status = err.status || err.statusCode || err.httpStatus;
  // err.code pode ser numérico (Mongoose: 11000) ou string ('TX_TIMEOUT').
  let code = typeof err.code === 'string' ? err.code : undefined;
  let details = err.details ?? null;

  // Chave duplicada do Mongo (índice único).
  if (err.code === 11000) {
    status = status || 409;
    code = 'DUPLICATE_KEY';
    if (!details && err.keyValue) details = { fields: Object.keys(err.keyValue) };
  }

  const known = KNOWN_BY_NAME[err.name];
  if (known) {
    status = status || known.status;
    code = code || known.code;
    // Detalha os campos que falharam na validação do Mongoose.
    if (err.name === 'ValidationError' && err.errors && !details) {
      details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    }
  }

  status = status || 500;
  code = code || STATUS_CODE[status] || 'INTERNAL_ERROR';

  // Erros 5xx podem carregar detalhes de banco, provedores externos e stack
  // traces. Em produção, só o requestId chega ao cliente; o detalhe fica no log.
  const message = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'Erro interno no servidor.'
    : (err.message || 'Erro interno no servidor.');

  const error = { code, message };
  if (details) error.details = details;
  if (requestId) error.requestId = requestId;

  return { status, body: { message, error } };
};

export const errorHandler = (err, req, res, _next) => {
  const requestId = req?.requestId || getRequestId();
  const { status, body } = buildErrorResponse(err, requestId);

  if (status >= 500) {
    logger.error(`Erro [${body.error.code}]: ${err.message}${err.stack ? `\n${err.stack}` : ''}`);
  } else {
    logger.warn(`Erro [${body.error.code}] ${status}: ${err.message}`);
  }

  // Persiste no ErrorLog para o painel do Admin. Só 5xx: 4xx é erro do cliente
  // (senha errada, validação) e encheria o painel de ruído que não é defeito nosso.
  //
  // `req.path` e nunca `req.originalUrl` — a mesma regra do access log: query
  // string vinda do cliente vaza segredo e permite forjar conteúdo no registro.
  //
  // Sem await: a resposta não deve esperar a gravação, e recordError já engole
  // a própria falha.
  if (status >= 500) {
    recordError({
      origin: 'HTTP',
      source: `${req?.method || '?'} ${req?.path || '?'}`,
      code: body.error.code,
      message: err.message,
      stack: err.stack || null,
      statusCode: status,
    });
  }

  res.status(status).json(body);
};

export default errorHandler;
