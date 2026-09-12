
import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
  // null = broadcast para todos os usuários
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

  type: {
    type: String,
    required: true,
    enum: ['RANKING_PUBLISHED', 'SUPPORT_REPLY'],
  },

  title:   { type: String, required: true },
  message: { type: String, required: true },

  // Campo opcional — ex.: 'STOCK', 'FII', 'CRYPTO'
  relatedAssetClass: { type: String },

  // Para onde o clique leva, quando levar a algum lugar (ex.: '/suporte?ticket=VT-0042').
  // Caminho INTERNO do app: o sino navega com o router e nunca abre destino externo
  // a partir de um campo do banco.
  link: { type: String, default: null },

  // Para notificações pessoais (user != null)
  isRead: { type: Boolean, default: false },

  // Para broadcasts (user == null): quais usuários já marcaram como lida
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  createdAt: { type: Date, default: Date.now },

  // TTL opcional: mongoose expira o documento automaticamente
  expiresAt: { type: Date },
});

// Índice principal de listagem: mais recentes primeiro
NotificationSchema.index({ createdAt: -1 });

// Acelera queries de broadcast não-lidas por usuário
NotificationSchema.index({ user: 1, createdAt: -1 });

// TTL — expira documentos quando expiresAt é preenchido
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
export default Notification;
