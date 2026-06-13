/**
 * (1.4) Proteção CSRF por double-submit cookie — defesa em profundidade.
 *
 * O sistema já é estruturalmente resistente a CSRF: as rotas autenticadas
 * autorizam pelo header `Authorization: Bearer` (lido do localStorage, que um
 * site atacante não consegue ler nem forjar como header cross-origin), e o
 * cookie de refresh é `sameSite: 'strict'`. Esta camada adiciona uma garantia
 * explícita, independente da aplicação correta de SameSite pelo navegador.
 *
 * Padrão double-submit:
 *  1. O servidor emite um `csrfToken` aleatório como cookie LEGÍVEL por JS
 *     (httpOnly:false) em login/refresh.
 *  2. O cliente lê o cookie e reenvia o valor no header `X-CSRF-Token` em toda
 *     requisição que altera estado.
 *  3. Este middleware compara header × cookie em tempo constante. Como o
 *     atacante não consegue ler o cookie cross-site, não consegue produzir o
 *     header correspondente.
 *
 * Fail-open quando NÃO há cookie csrf: cobre clientes ainda não "bootstrapados"
 * (pré-login), sessões anteriores ao deploy (que recebem o token no próximo
 * refresh, em até 15min) e chamadas servidor-a-servidor (webhooks). Essas rotas
 * já são protegidas pelo Bearer/SameSite; a ausência do cookie não cria brecha
 * nova. Quando o cookie EXISTE, a verificação é estrita (fail-closed).
 */
import crypto from 'crypto';

export const CSRF_COOKIE = 'csrfToken';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isProd = () => process.env.NODE_ENV === 'production';

// httpOnly:false é proposital — o cliente PRECISA ler o valor para reenviá-lo
// no header. O segredo de sessão (refresh token) continua httpOnly à parte.
const cookieOptions = () => ({
  httpOnly: false,
  secure: isProd(),
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // espelha a vida do refresh token
});

// Comparação em tempo constante; exige mesmo comprimento para evitar throw.
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

/**
 * Garante um token CSRF no response. Por padrão reaproveita o cookie existente
 * (idempotente entre requests da mesma sessão); com `{ rotate: true }` gera um
 * novo — usado no login para casar a rotação com o início da sessão.
 */
export const issueCsrfToken = (req, res, { rotate = false } = {}) => {
  let token = req.cookies?.[CSRF_COOKIE];
  if (rotate || !token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, cookieOptions());
  }
  return token;
};

export const clearCsrfToken = (res) => {
  res.clearCookie(CSRF_COOKIE, { sameSite: 'strict', secure: isProd() });
};

export const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  // Sem cookie emitido → fail-open (ver cabeçalho do arquivo).
  if (!cookieToken) return next();

  const headerToken = req.get(CSRF_HEADER);
  if (headerToken && safeEqual(headerToken, cookieToken)) return next();

  return res.status(403).json({
    message: 'Falha na verificação de segurança (CSRF). Recarregue a página e tente novamente.',
  });
};
