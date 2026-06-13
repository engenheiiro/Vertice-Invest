/**
 * (I5) Rate limiters por USUÁRIO para rotas caras/autenticadas.
 *
 * O limiter global do `app.js` é por IP — injusto atrás de NAT/CGNAT (vários
 * usuários dividem o orçamento) e evadível por quem troca de IP. Como estas
 * rotas rodam após `authenticateToken`, `req.user.id` está garantido, então a
 * chave é o id do usuário (fallback para IP em rota não-autenticada).
 */
import rateLimit from 'express-rate-limit';

// Chave: usuário autenticado → `u:<id>`; senão → IP. Como o consumidor sempre
// monta o limiter depois do authenticateToken, o ramo de IP é só defensivo.
const userKey = (req) => (req.user?.id ? `u:${req.user.id}` : req.ip);

const baseOptions = {
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
};

const createUserLimiter = ({ windowMs, max, message }) =>
  rateLimit({ ...baseOptions, windowMs, max, message: { message } });

// Escrita de carteira: 50 ops / 15min por usuário (substitui o writeLimiter por IP).
export const walletWriteLimiter = createUserLimiter({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Muitas operações de escrita. Aguarde 15 minutos.',
});

// Research pesado (full-pipeline, crunch, sync): 20 / 15min por usuário.
export const researchHeavyLimiter = createUserLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Muitas requisições pesadas de pesquisa. Aguarde alguns minutos.',
});

// Leitura cara de research (latest/macro/signals com agregação): 300 / 15min.
export const researchReadLimiter = createUserLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Muitas requisições. Aguarde alguns minutos.',
});

// Rotas de configuração e diagnóstico exclusivas de admin: 60/15min por usuário.
// Isolado do researchHeavyLimiter para que operações de config não consumam
// o orçamento de pipeline/sync e vice-versa.
export const adminLimiter = createUserLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Muitas operações de administração. Aguarde alguns minutos.',
});

export { createUserLimiter };
