import express from 'express';
import { register, login, refreshToken, logout, forgotPassword, resetPassword } from '../controllers/authController.js';
import validate from '../middleware/validateResource.js';
import { registerSchema, loginSchema } from '../schemas/authSchemas.js';

const router = express.Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', refreshToken);
router.post('/logout', logout);

// Rotas de Recuperação de Senha (Geralmente não precisam de schemas complexos além de checar campos)
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;