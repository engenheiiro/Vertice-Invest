/**
 * (S8) Sanitização de input contra injeção de operadores NoSQL e poluição de
 * protótipo — camada extra além do casting do Mongoose.
 *
 * Remove de body/query/params qualquer chave que:
 *  - comece com `$`  → operadores Mongo ($gt, $ne, $where, ...)
 *  - contenha `.`    → dotted-path injection
 *  - seja `__proto__` / `constructor` / `prototype` → prototype pollution
 *
 * Atua apenas nas CHAVES (valores são preservados). Profundidade limitada para
 * evitar DoS por payloads aninhados.
 */

const isDangerousKey = (key) =>
  key.startsWith('$') ||
  key.includes('.') ||
  key === '__proto__' ||
  key === 'constructor' ||
  key === 'prototype';

const sanitizeInPlace = (obj, depth = 0) => {
  if (depth > 10 || !obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    obj.forEach((item) => sanitizeInPlace(item, depth + 1));
    return obj;
  }

  for (const key of Object.keys(obj)) {
    if (isDangerousKey(key)) {
      delete obj[key];
    } else {
      sanitizeInPlace(obj[key], depth + 1);
    }
  }
  return obj;
};

export const sanitizeInput = (req, res, next) => {
  if (req.body) sanitizeInPlace(req.body);
  if (req.params) sanitizeInPlace(req.params);
  if (req.query) sanitizeInPlace(req.query);
  next();
};

// Exportado para teste unitário.
export { sanitizeInPlace };
