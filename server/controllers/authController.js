
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

// Helper para Log
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
        }).catch(err => logger.error(`Erro log: ${err.message}`));
    } catch (e) {}
};

export const register = async (req, res, next) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();

    const { name, email, password } = req.body;

    if (!name || name.length < 2) throw new Error("Nome muito curto.");
    if (!password || password.length < 6) throw new Error("Senha deve ter no mínimo 6 caracteres.");

    const userExists = await User.findOne({ email }).session(session);
    
    if (userExists) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ message: "Este email já está cadastrado." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ 
      name, 
      email, 
      password: hashedPassword,
      role: 'USER', 
      plan: 'GUEST', 
      subscriptionStatus: 'ACTIVE',
      validUntil: null,
      hasSeenTutorial: false 
    });
    
    await newUser.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    res.status(201).json({ message: "Conta criada com sucesso!" });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fallback_refresh_secret";

    if (!JWT_SECRET) throw new Error("JWT_SECRET não configurado.");

    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    const invalidMsg = "Credenciais inválidas.";

    if (!user) {
        return res.status(401).json({ message: invalidMsg });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
        return res.status(401).json({ message: invalidMsg });
    }

    // Geração de Tokens
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
      message: "Login realizado.",
      accessToken,
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        plan: user.plan,
        role: user.role, 
        subscriptionStatus: user.subscriptionStatus,
        validUntil: user.validUntil, // Envia data de validade para o frontend
        hasSeenTutorial: user.hasSeenTutorial,
        cpf: user.cpf 
      }
    });

  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    const cookies = req.cookies;
    if (!cookies?.jwt) return res.status(401).json({ message: "Sessão inválida." });
    
    const requestToken = cookies.jwt;
    const tokenInDb = await RefreshToken.findOne({ token: requestToken });
    
    if (!tokenInDb || RefreshToken.verifyExpiration(tokenInDb)) {
      if (tokenInDb) await RefreshToken.findByIdAndDelete(tokenInDb._id);
      return res.status(403).json({ message: "Sessão expirada." });
    }

    const user = await User.findById(tokenInDb.user);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

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
       res.clearCookie('jwt', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
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

    if (!user) return res.status(200).json({ message: "Se o email existir, instruções foram enviadas." });

    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const origin = req.get('origin') || 'http://localhost:5173';
    await sendResetPasswordEmail(user.email, token, origin);

    res.status(200).json({ message: "Se o email existir, instruções foram enviadas." });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: Date.now() } });

    if (!user) return res.status(400).json({ message: "Token inválido ou expirado." });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Senha atualizada." });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { name, cpf } = req.body;
        const cleanCpf = cpf ? cpf.replace(/\D/g, '') : null;

        if (cleanCpf) {
            const existing = await User.findOne({ cpf: cleanCpf });
            if (existing && existing._id.toString() !== userId) return res.status(409).json({ message: "CPF já utilizado." });
        }

        const updatedUser = await User.findByIdAndUpdate(userId, { name, cpf: cleanCpf }, { new: true });
        
        res.json({ 
            message: "Perfil atualizado.", 
            user: {
                id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                role: updatedUser.role,
                plan: updatedUser.plan,
                validUntil: updatedUser.validUntil,
                hasSeenTutorial: updatedUser.hasSeenTutorial,
                cpf: updatedUser.cpf
            } 
        });
    } catch (error) {
        next(error);
    }
};

export const changePassword = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { oldPassword, newPassword } = req.body;

        const user = await User.findById(userId);
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(401).json({ message: "Senha atual incorreta." });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.json({ message: "Senha alterada." });
    } catch (error) {
        next(error);
    }
};

export const markTutorialSeen = async (req, res, next) => {
    try {
        await User.findByIdAndUpdate(req.user.id, { hasSeenTutorial: true });
        res.status(200).json({ success: true });
    } catch (error) {
        next(error);
    }
};
