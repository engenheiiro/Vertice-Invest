
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import logger from '../config/logger.js'; // (M10) logger estruturado
import { getCachedUser, setCachedUser } from '../utils/userCache.js'; // (I6) cache de plano
import { isSubscriptionExpired } from '../services/subscriptionService.js';
import { hasPlanAtLeast } from '../config/subscription.js';

// Middleware 1: Verifica Token E Validade da Assinatura
export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Acesso negado. Token não fornecido." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Tokens legados (sem sv) passam pelo refresh uma única vez. Isto evita
    // mantê-los ativos até a expiração e estabelece o controle de revogação
    // imediata para todas as sessões seguintes.
    const tokenSessionVersion = Number.isInteger(decoded.sv) ? decoded.sv : null;

    // (I6) Cache hit — serve sem tocar o banco, exceto se um plano pago expirou
    // (aí precisamos do caminho de DB para rebaixar e persistir).
    const cached = getCachedUser(decoded.id);
    if (
      tokenSessionVersion !== null
      && cached
      && cached.sessionVersion === tokenSessionVersion
      && !isSubscriptionExpired(cached)
    ) {
      req.user = cached;
      return next();
    }

    // Busca o usuário atualizado no banco para checar validade (Crítico para expiração)
    const user = await User.findById(decoded.id).select('name email role plan subscriptionStatus subscriptionType validUntil isActive sessionVersion');

    if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado." });
    }

    if (user.isActive === false) {
        return res.status(401).json({ message: "Conta desativada." });
    }

    if (tokenSessionVersion === null || tokenSessionVersion !== (user.sessionVersion ?? 0)) {
        return res.status(401).json({ message: "Sessão desatualizada. Entre novamente." });
    }

    // --- LÓGICA DE EXPIRAÇÃO (GUARDIÃO) ---
    // Regra única em subscriptionService: assinatura recorrente ativa ganha a
    // carência de RECURRING_GRACE_DAYS antes de cair (o MP cobra em horário
    // próprio e ainda retenta por alguns dias).
    if (isSubscriptionExpired(user)) {
        // (M10/S9) Loga por userId — evita PII (email) em claro no log.
        logger.info(`🔒 Assinatura expirou (user ${user._id}) em ${user.validUntil}. Rebaixando para GUEST.`);

        user.plan = 'GUEST';
        user.subscriptionStatus = 'PAST_DUE'; // Ou CANCELED
        // Mantemos a data antiga como registro histórico.
        await user.save();
    }

    // (I6) Objeto plano (não-Mongoose) cacheado e injetado. Handlers usam só
    // id/_id/role/plan — sem métodos de documento — então é seguro.
    const userData = {
      _id: user._id,
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      // Necessário no cache: isSubscriptionExpired só concede a carência a
      // assinaturas RECURRING. Sem este campo, o caminho de cache trataria todo
      // assinante como avulso e derrubaria o acesso durante a renovação.
      subscriptionType: user.subscriptionType,
      validUntil: user.validUntil,
      sessionVersion: user.sessionVersion ?? 0,
    };
    setCachedUser(decoded.id, userData);

    req.user = userData; // Injeta o usuário (possivelmente atualizado) na requisição
    next();

  } catch {
    return res.status(401).json({ message: "Token inválido ou expirado." });
  }
};

// Catálogos públicos podem aproveitar dados da sessão quando ela é válida, mas
// nunca devem identificar um usuário a partir de um token apenas decodificado.
// Sem Bearer, a rota segue como visitante; com Bearer, aplica exatamente a mesma
// verificação criptográfica da autenticação obrigatória.
export const optionalAuthenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();
  return authenticateToken(req, res, next);
};

// Middleware 2: Verifica se o usuário é ADMIN
export const requireAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'ADMIN') {
        next();
    } else {
        return res.status(403).json({ message: "Acesso restrito a administradores." });
    }
};

// Middleware 3: Fábrica de gate por degrau de plano. Uma implementação só para
// todos os "a partir do plano X" — a hierarquia mora em config/subscription.js
// (PLAN_HIERARCHY), não em listas de planos repetidas por rota. ADMIN passa,
// mesmo critério da isenção de expiração acima.
export const requireMinPlan = (minPlan, message) => (req, res, next) => {
    if (hasPlanAtLeast(req.user, minPlan)) return next();
    return res.status(403).json({ message, requiredPlan: minPlan });
};

// Rebalanceamento IA: ELITE+ (poder de IA). PRO não tem.
export const requireElitePlan = requireMinPlan(
    'ELITE',
    'Rebalanceamento com IA é um recurso exclusivo dos planos Elite e Black.',
);

// Relatório de apoio ao IR: ELITE+ (Onda 3 do plano comercial de 30/08/2026).
// Era exclusivo do BLACK, que saiu da venda — o card do Elite passou a prometer
// o relatório, então o gate desceu junto. Quem é BLACK continua entrando pela
// hierarquia, sem precisar de regra própria.
export const requireTaxReportPlan = requireMinPlan(
    'ELITE',
    'O Relatório de apoio ao Imposto de Renda é um recurso do plano Elite.',
);

// Proventos e Dividendos: ESSENTIAL+. É o diferencial anunciado do primeiro
// degrau pago — sem este gate a linha do card não separava plano nenhum.
export const requireDividendsPlan = requireMinPlan(
    'ESSENTIAL',
    'O painel de Proventos e Dividendos começa no plano Essential.',
);
