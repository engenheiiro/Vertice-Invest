/**
 * (I4) Resiliência para integrações externas: retry com backoff e circuit breaker.
 *
 * - withRetry: re-tenta uma operação transitória com backoff exponencial + jitter.
 * - CircuitBreaker: após N falhas consecutivas para um provedor, "abre" o circuito
 *   e passa a falhar rápido por um cooldown — evita martelar um serviço caído e,
 *   num lote de centenas de tickers, pula o provedor morto em vez de esperar o
 *   timeout de cada chamada. Depois do cooldown entra em HALF_OPEN (1 tentativa);
 *   sucesso fecha, falha reabre.
 */
import logger from '../config/logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const withRetry = async (fn, {
  retries = 2,
  baseDelayMs = 200,
  factor = 2,
  maxDelayMs = 4000,
  shouldRetry = () => true,
  onRetry = null,
} = {}) => {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) break;
      const expo = Math.min(maxDelayMs, baseDelayMs * factor ** attempt);
      // Jitter: atraso aleatório em [expo/2, expo] para evitar thundering herd.
      const delay = Math.round(expo / 2 + Math.random() * (expo / 2));
      if (onRetry) onRetry(err, attempt + 1, delay);
      await sleep(delay);
      attempt++;
    }
  }
  throw lastErr;
};

export class CircuitBreaker {
  constructor({ name = 'cb', failureThreshold = 5, cooldownMs = 30_000 } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
    this.failures = 0;
    this.openedAt = 0;
  }

  // Getter com efeito: transiciona OPEN→HALF_OPEN quando o cooldown vence.
  get isOpen() {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  recordFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      const wasOpen = this.state === 'OPEN';
      this.state = 'OPEN';
      this.openedAt = Date.now();
      if (!wasOpen) {
        logger.warn(`🔌 Circuit breaker [${this.name}] ABERTO após ${this.failures} falhas. Cooldown ${this.cooldownMs}ms.`);
      }
    }
  }

  /**
   * Executa fn respeitando o estado do circuito.
   * Se `fallback` for fornecido, ele é retornado (em vez de lançar) tanto quando
   * o circuito está aberto quanto quando fn falha. Sem fallback, propaga o erro.
   */
  async exec(fn, fallback) {
    const hasFallback = arguments.length >= 2;
    if (this.isOpen) {
      if (hasFallback) return typeof fallback === 'function' ? fallback() : fallback;
      const err = new Error(`Circuit breaker [${this.name}] aberto`);
      err.code = 'ERR_CIRCUIT_OPEN';
      throw err;
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      if (hasFallback) return typeof fallback === 'function' ? fallback() : fallback;
      throw err;
    }
  }
}

export const createCircuitBreaker = (opts) => new CircuitBreaker(opts);
