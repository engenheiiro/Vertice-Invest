
import express from 'express';
import { register, login, refreshToken, logout, forgotPassword, resetPassword, updateProfile, updateAvatar, removeAvatar, changePassword, markTutorialSeen, deactivateAccount, exportData, deleteAccount } from '../controllers/authController.js';
import { getMfaStatus, setupMfa, enableMfa, disableMfa } from '../controllers/mfaController.js'; // (I14)
import validate from '../middleware/validateResource.js';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  avatarSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  mfaSetupSchema,
  mfaEnableSchema,
  mfaDisableSchema,
} from '../schemas/authSchemas.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { dataExportLimiter, accountDeleteLimiter, avatarUploadLimiter, changePasswordLimiter, mfaWriteLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();

// Rotas Públicas
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', refreshToken);
router.post('/logout', logout);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

// Rotas Protegidas (Perfil)
router.put('/me', authenticateToken, validate(updateProfileSchema), updateProfile);
// (3.17) Foto de perfil — rate limiter dedicado (payload maior).
router.put('/me/avatar', avatarUploadLimiter, authenticateToken, validate(avatarSchema), updateAvatar);
router.delete('/me/avatar', authenticateToken, removeAvatar);
router.post('/change-password', changePasswordLimiter, authenticateToken, changePassword);
router.post('/tutorial-seen', authenticateToken, markTutorialSeen);
router.post('/me/deactivate', authenticateToken, deactivateAccount);
router.get('/me/export', dataExportLimiter, authenticateToken, exportData);
router.delete('/me', accountDeleteLimiter, authenticateToken, deleteAccount);

// (I14) MFA / 2FA — todas exigem sessão autenticada.
router.get('/mfa/status', authenticateToken, getMfaStatus);
router.post('/mfa/setup', authenticateToken, mfaWriteLimiter, validate(mfaSetupSchema), setupMfa);
router.post('/mfa/enable', authenticateToken, mfaWriteLimiter, validate(mfaEnableSchema), enableMfa);
router.post('/mfa/disable', authenticateToken, mfaWriteLimiter, validate(mfaDisableSchema), disableMfa);

export default router;
