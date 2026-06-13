
import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { researchReadLimiter } from '../middleware/rateLimiters.js';
import Notification from '../models/Notification.js';
import logger from '../config/logger.js';

const router = express.Router();

// Todas as rotas aqui requerem autenticação
router.use(authenticateToken);

/**
 * GET /api/notifications
 * Lista as 30 notificações mais recentes relevantes para o usuário:
 *   - Pessoais (user == req.user.id)
 *   - Broadcasts (user == null) que não foram lidas por este usuário e não expiraram
 * Retorna também unreadCount.
 */
router.get('/', researchReadLimiter, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const notifications = await Notification.find({
      $or: [
        { user: userId },
        {
          user: null,
          readBy: { $ne: userId },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    // Conta não lidas: pessoais com isRead=false + broadcasts (nunca têm isRead, já filtradas acima)
    const unreadCount = notifications.filter((n) => {
      if (n.user) return !n.isRead;
      return true; // broadcast que apareceu no resultado = não lida
    }).length;

    res.json({ notifications, unreadCount });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/notifications/:id/read
 * Marca uma notificação específica como lida.
 *   - Pessoal: seta isRead = true
 *   - Broadcast: adiciona userId em readBy
 */
router.put('/:id/read', researchReadLimiter, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notificação não encontrada.' });
    }

    if (notification.user) {
      // Notificação pessoal: só o dono pode marcar
      if (notification.user.toString() !== userId) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
      notification.isRead = true;
    } else {
      // Broadcast: adiciona o usuário em readBy se ainda não estiver
      if (!notification.readBy.map(String).includes(userId)) {
        notification.readBy.push(userId);
      }
    }

    await notification.save();
    res.json({ message: 'Marcada como lida.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/read-all
 * Marca todas as notificações não lidas do usuário como lidas de uma vez.
 */
router.post('/read-all', researchReadLimiter, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    // Pessoais não lidas
    await Notification.updateMany(
      { user: userId, isRead: false },
      { $set: { isRead: true } }
    );

    // Broadcasts não lidas por este usuário
    await Notification.updateMany(
      {
        user: null,
        readBy: { $ne: userId },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
      { $addToSet: { readBy: userId } }
    );

    res.json({ message: 'Todas as notificações marcadas como lidas.' });
  } catch (err) {
    next(err);
  }
});

export default router;
