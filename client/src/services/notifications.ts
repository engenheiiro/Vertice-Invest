import { authService } from './auth';

export interface AppNotification {
  _id: string;
  user: string | null;
  type: string;
  title: string;
  message: string;
  relatedAssetClass?: string;
  isRead: boolean;
  readBy: string[];
  createdAt: string;
  expiresAt?: string;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
}

export const notificationsService = {
  async getNotifications(): Promise<NotificationsResponse> {
    const response = await authService.api('/api/notifications');
    if (!response.ok) return { notifications: [], unreadCount: 0 };
    return response.json();
  },

  async markRead(id: string): Promise<void> {
    await authService.api(`/api/notifications/${id}/read`, { method: 'PUT' });
  },

  async markAllRead(): Promise<void> {
    await authService.api('/api/notifications/read-all', { method: 'POST' });
  },
};
