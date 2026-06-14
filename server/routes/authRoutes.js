
import express from 'express';
import { register, login, refreshToken, logout, forgotPassword, resetPassword, updateProfile, changePassword, markTutorialSeen, deactivateAccount, exportData, deleteAccount } from '../controllers/authController.js';
import { getMfaStatus, setupMfa, enableMfa, disableMfa } from '../controllers/mfaController.js'; // (I14)
import validate from '../middleware/validateResource.js';
import { registerSchema, loginSchema } from '../schemas/authSchemas.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { dataExportLimiter, accountDeleteLimiter } from '../middleware/rateLimiters.js';

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
router.post('/tutorial-seen', authenticateToken, markTutorialSeen);
router.post('/me/deactivate', authenticateToken, deactivateAccount);
router.get('/me/export', dataExportLimiter, authenticateToken, exportData);
router.delete('/me', accountDeleteLimiter, authenticateToken, deleteAccount);

// (I14) MFA / 2FA — todas exigem sessão autenticada.
router.get('/mfa/status', authenticateToken, getMfaStatus);
router.post('/mfa/setup', authenticateToken, setupMfa);
router.post('/mfa/enable', authenticateToken, enableMfa);
router.post('/mfa/disable', authenticateToken, disableMfa);

export default router;
