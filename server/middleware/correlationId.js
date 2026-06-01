/**
 * (D12) Correlation ID por requisição.
 *
 * Usa o `x-request-id` recebido (ex.: vindo de um proxy/loadbalancer) ou gera
 * um UUID. Devolve o id no header da resposta e roda o restante da cadeia dentro
 * do AsyncLocalStorage, para que os logs daquela requisição carreguem o id.
 */
import crypto from 'crypto';
import { runWithRequestId } from '../utils/requestContext.js';

export const correlationId = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const id = (typeof incoming === 'string' && incoming.trim())
    ? incoming.trim().slice(0, 100) // limita tamanho (defensivo)
    : crypto.randomUUID();

  req.requestId = id;
  res.setHeader('x-request-id', id);

  runWithRequestId(id, () => next());
};
