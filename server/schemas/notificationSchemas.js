import { z } from 'zod';
import { typeMessages } from './zodMessages.js';

// ObjectId do Mongo: 24 hex. Sem isto, `PUT /notifications/abc/read` virava
// CastError no findById e a resposta era 500 em vez de 400.
const objectId = z.string(typeMessages()).regex(/^[0-9a-fA-F]{24}$/, 'Notificação inválida.');

export const notificationIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

// read-all não recebe nada: corpo extra é recusado em vez de ignorado.
export const readAllNotificationsSchema = z.object({
  body: z.object({}).strict().optional(),
});
