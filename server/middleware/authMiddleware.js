import jwt from 'jsonwebtoken';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Formato: "Bearer TOKEN"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Acesso negado. Token não fornecido." });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token inválido ou expirado." });
    
    // Anexa o usuário decodificado ao request
    req.user = user;
    next();
  });
};