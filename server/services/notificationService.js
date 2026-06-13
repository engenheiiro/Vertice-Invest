
import Notification from '../models/Notification.js';
import logger from '../config/logger.js';

/**
 * Cria uma notificação para um único usuário.
 *
 * @param {{ user: string, type: string, title: string, message: string, relatedAssetClass?: string }} opts
 */
export async function createNotification({ user, type, title, message, relatedAssetClass }) {
  try {
    const doc = await Notification.create({ user, type, title, message, relatedAssetClass });
    logger.info(`[notification] criada id=${doc._id} type=${type} user=${user}`);
    return doc;
  } catch (err) {
    // Nunca deixar falha de notificação derrubar o fluxo principal
    logger.error(`[notification] erro ao criar: ${err.message}`);
    return null;
  }
}

/**
 * Cria uma notificação de broadcast (sem user — visível para todos).
 *
 * @param {{ type: string, title: string, message: string, relatedAssetClass?: string }} opts
 */
export async function createBroadcast({ type, title, message, relatedAssetClass }) {
  try {
    const doc = await Notification.create({ user: null, type, title, message, relatedAssetClass });
    logger.info(`[notification] broadcast criado id=${doc._id} type=${type}`);
    return doc;
  } catch (err) {
    logger.error(`[notification] erro ao criar broadcast: ${err.message}`);
    return null;
  }
}
