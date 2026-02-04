
import express from 'express';
import { register, login, refreshToken, logout, forgotPassword, resetPassword, updateProfile, changePassword } from '../controllers/authController.js';
import validate from '../middleware/validateResource.js';
import { registerSchema, loginSchema } from '../schemas/authSchemas.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Rotas Públicas
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', refreshToken);
router.post('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Rotas Protegidas (Perfil)
router.put('/me', authenticateToken, updateProfile);
router.post('/change-password', authenticateToken, changePassword);

export default router;
