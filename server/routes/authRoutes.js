
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
  changePasswordSchema,
  deactivateAccountSchema,
  deleteAccountSchema,
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
// Limiter POR USUÁRIO vem DEPOIS do authenticateToken: antes dele `req.user` não
// existe e o `userKey` cai no IP — trocar de IP renovava o orçamento de tentativas
// de senha (change-password/deactivate/DELETE /me) de uma sessão sequestrada, e
// usuários atrás do mesmo NAT dividiam um balde só. (Exceção à ordem
// "limiter → auth" do CLAUDE.md, que vale para limiter por IP.)
router.put('/me', authenticateToken, validate(updateProfileSchema), updateProfile);
// (3.17) Foto de perfil — rate limiter dedicado (payload maior).
router.put('/me/avatar', authenticateToken, avatarUploadLimiter, validate(avatarSchema), updateAvatar);
router.delete('/me/avatar', authenticateToken, removeAvatar);
router.post('/change-password', authenticateToken, changePasswordLimiter, validate(changePasswordSchema), changePassword);
router.post('/tutorial-seen', authenticateToken, markTutorialSeen);
// Desativar confere a senha (bcrypt): sem limiter, uma sessão sequestrada tinha o
// orçamento do apiLimiter inteiro para adivinhá-la. Divide o balde da exclusão.
router.post('/me/deactivate', authenticateToken, accountDeleteLimiter, validate(deactivateAccountSchema), deactivateAccount);
router.get('/me/export', authenticateToken, dataExportLimiter, exportData);
router.delete('/me', authenticateToken, accountDeleteLimiter, validate(deleteAccountSchema), deleteAccount);

// (I14) MFA / 2FA — todas exigem sessão autenticada.
router.get('/mfa/status', authenticateToken, getMfaStatus);
router.post('/mfa/setup', authenticateToken, mfaWriteLimiter, validate(mfaSetupSchema), setupMfa);
router.post('/mfa/enable', authenticateToken, mfaWriteLimiter, validate(mfaEnableSchema), enableMfa);
router.post('/mfa/disable', authenticateToken, mfaWriteLimiter, validate(mfaDisableSchema), disableMfa);

export default router;
