
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Middleware 1: Verifica Token E Validade da Assinatura
export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Acesso negado. Token não fornecido." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
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
            console.log(`🔒 Assinatura de ${user.email} expirou em ${validUntil}. Rebaixando para GUEST.`);
            
            user.plan = 'GUEST';
            user.subscriptionStatus = 'PAST_DUE'; // Ou CANCELED
            // Mantemos a data antiga como registro histórico ou limpamos? Melhor manter.
            await user.save();
        }
    }

    req.user = user; // Injeta o usuário (possivelmente atualizado) na requisição
    next();

  } catch (err) {
    return res.status(403).json({ message: "Token inválido ou expirado." });
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
