import jwt from 'jsonwebtoken';

// Middleware 1: Apenas verifica se o usuário está logado
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Acesso negado. Token não fornecido." });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token inválido ou expirado." });
    
    req.user = user; // { id, email, plan, role }
    next();
  });
};

// Middleware 2: Verifica se o usuário é ADMIN (Deve ser usado DEPOIS do authenticateToken)
export const requireAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'ADMIN') {
        next();
    } else {
        return res.status(403).json({ message: "Acesso restrito a administradores. Você não tem permissão." });
    }
};