import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import AuditLog from '../models/AuditLog.js';
import { sendResetPasswordEmail } from '../services/emailService.js';
import logger from '../config/logger.js';

// Configurações
const ACCESS_TOKEN_EXPIRATION = '15m';
const REFRESH_TOKEN_EXPIRATION_DAYS = 7;

// Helper para Log de Auditoria
const logAudit = async (req, action, details, userId = null, email = null) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        AuditLog.create({
            user: userId,
            email: email,
            action,
            details,
            ipAddress: Array.isArray(ip) ? ip[0] : ip,
            userAgent: req.headers['user-agent']
        }).catch(err => logger.error(`Erro ao salvar log de auditoria: ${err.message}`));
    } catch (e) {
        logger.error(`Falha na chamada de log: ${e.message}`);
    }
};

export const register = async (req, res, next) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();

    const { name, email, password } = req.body;

    const userExists = await User.findOne({ email }).session(session);
    
    if (userExists) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ message: "Este email já está cadastrado." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Criação do usuário (Padrão: USER e ESSENTIAL)
    const newUser = new User({ 
      name, 
      email, 
      password: hashedPassword,
      role: 'USER', 
      plan: 'ESSENTIAL',
      subscriptionStatus: 'ACTIVE',
      validUntil: null
    });
    
    await newUser.save({ session });
    
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    await AuditLog.create([{
        user: newUser._id,
        email: email,
        action: 'REGISTER_SUCCESS',
        details: 'Novo usuário registrado',
        ipAddress: Array.isArray(ip) ? ip[0] : ip,
        userAgent: req.headers['user-agent']
    }], { session });

    await session.commitTransaction();
    session.endSession();
    
    logger.info(`Novo usuário registrado: ${email}`);
    res.status(201).json({ message: "Conta criada com sucesso!" });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error(`Erro na transação de registro: ${error.message}`);
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fallback_refresh_secret";

    if (!JWT_SECRET) throw new Error("JWT_SECRET não configurado no servidor.");

    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    const invalidCredentialsMsg = "Credenciais inválidas.";

    if (!user) {
        logAudit(req, 'LOGIN_FAIL', 'Usuário inexistente', null, email);
        return res.status(401).json({ message: invalidCredentialsMsg });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
        logAudit(req, 'LOGIN_FAIL', 'Senha incorreta', user._id, email);
        return res.status(401).json({ message: invalidCredentialsMsg });
    }

    // Incluindo ROLE no Payload do Token
    const accessToken = jwt.sign(
      { id: user._id, email: user.email, plan: user.plan, role: user.role }, 
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRATION }
    );

    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + REFRESH_TOKEN_EXPIRATION_DAYS);

    const refreshTokenString = jwt.sign(
      { id: user._id }, 
      JWT_REFRESH_SECRET, 
      { expiresIn: `${REFRESH_TOKEN_EXPIRATION_DAYS}d` }
    );

    await RefreshToken.create({
      token: refreshTokenString,
      user: user._id,
      expiryDate: expiredAt,
    });

    res.cookie('jwt', refreshTokenString, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
    });

    logAudit(req, 'LOGIN_SUCCESS', 'Login via Senha', user._id, email);
    
    res.status(200).json({ 
      message: "Login realizado com sucesso.",
      accessToken,
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        plan: user.plan,
        role: user.role, // Enviando role para o front
        subscriptionStatus: user.subscriptionStatus
      }
    });

  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) throw new Error("JWT_SECRET não configurado.");

    const cookies = req.cookies;
    if (!cookies?.jwt) return res.status(401).json({ message: "Sessão inválida." });
    
    const requestToken = cookies.jwt;

    const tokenInDb = await RefreshToken.findOne({ token: requestToken });
    if (!tokenInDb) {
      return res.status(403).json({ message: "Token inválido." });
    }

    if (RefreshToken.verifyExpiration(tokenInDb)) {
      await RefreshToken.findByIdAndDelete(tokenInDb._id);
      return res.status(403).json({ message: "Sessão expirada. Faça login novamente." });
    }

    const user = await User.findById(tokenInDb.user);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

    // Atualizando Access Token com Role atualizada
    const newAccessToken = jwt.sign(
      { id: user._id, email: user.email, plan: user.plan, role: user.role },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRATION }
    );

    res.status(200).json({ accessToken: newAccessToken });

  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    const cookies = req.cookies;
    if (cookies?.jwt) {
       await RefreshToken.findOneAndDelete({ token: cookies.jwt });
       
       try {
         const decoded = jwt.decode(cookies.jwt);
         if (decoded?.id) {
            logAudit(req, 'LOGOUT', 'Logout realizado', decoded.id);
         }
       } catch (e) {}

       res.clearCookie('jwt', { 
           httpOnly: true, 
           sameSite: 'strict', 
           secure: process.env.NODE_ENV === 'production' 
       });
    }
    res.status(200).json({ message: "Logout realizado." });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json({ message: "Se o email estiver cadastrado, as instruções foram enviadas." });
    }

    const token = crypto.randomBytes(20).toString('hex');
    
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    logAudit(req, 'FORGOT_PASSWORD_REQUEST', 'Solicitação de reset', user._id, email);

    const origin = req.get('origin') || 'http://localhost:5173';
    await sendResetPasswordEmail(user.email, token, origin);

    res.status(200).json({ message: "Se o email estiver cadastrado, as instruções foram enviadas." });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    const user = await User.findOne({ 
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: "Link de redefinição inválido ou expirado." });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();
    
    logAudit(req, 'PASSWORD_RESET_SUCCESS', 'Senha alterada com sucesso', user._id, user.email);

    res.status(200).json({ message: "Senha atualizada com sucesso." });
  } catch (error) {
    next(error);
  }
};