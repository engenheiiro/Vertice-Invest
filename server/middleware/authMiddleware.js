
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import logger from '../config/logger.js'; // (M10) logger estruturado
import { getCachedUser, setCachedUser } from '../utils/userCache.js'; // (I6) cache de plano

// Plano pago cuja validade já passou precisa ser rebaixado (e persistido) —
// nunca servir do cache neste caso.
const isExpiredPaid = (u) => {
  if (u.plan === 'GUEST' || u.role === 'ADMIN') return false;
  const validUntil = u.validUntil ? new Date(u.validUntil) : null;
  return !validUntil || validUntil < new Date();
};

// Middleware 1: Verifica Token E Validade da Assinatura
export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Acesso negado. Token não fornecido." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // (I6) Cache hit — serve sem tocar o banco, exceto se um plano pago expirou
    // (aí precisamos do caminho de DB para rebaixar e persistir).
    const cached = getCachedUser(decoded.id);
    if (cached && !isExpiredPaid(cached)) {
      req.user = cached;
      return next();
    }

    // Busca o usuário atualizado no banco para checar validade (Crítico para expiração)
    const user = await User.findById(decoded.id).select('name email role plan subscriptionStatus validUntil');

    if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado." });
    }

    // --- LÓGICA DE EXPIRAÇÃO (GUARDIÃO) ---
    // Se não for GUEST e não for ADMIN, verifica a data
    if (user.plan !== 'GUEST' && user.role !== 'ADMIN') {
        const now = new Date();
        const validUntil = user.validUntil ? new Date(user.validUntil) : null;

        // Se não tem data ou já passou a data
        if (!validUntil || validUntil < now) {
            // (M10/S9) Loga por userId — evita PII (email) em claro no log.
            logger.info(`🔒 Assinatura expirou (user ${user._id}) em ${validUntil}. Rebaixando para GUEST.`);

            user.plan = 'GUEST';
            user.subscriptionStatus = 'PAST_DUE'; // Ou CANCELED
            // Mantemos a data antiga como registro histórico ou limpamos? Melhor manter.
            await user.save();
        }
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
      validUntil: user.validUntil,
    };
    setCachedUser(decoded.id, userData);

    req.user = userData; // Injeta o usuário (possivelmente atualizado) na requisição
    next();

  } catch (err) {
    return res.status(401).json({ message: "Token inválido ou expirado." });
  }
};

// Middleware 2: Verifica se o usuário é ADMIN
export const requireAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'ADMIN') {
        next();
    } else {
        return res.status(403).json({ message: "Acesso restrito a administradores." });
    }
};
