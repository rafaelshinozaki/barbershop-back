import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { SmartLogger } from '../common/logger.util';

// Teto das listas do sininho (antes "não lidas" e "novas" não tinham limite)
const MAX_LIST = 100;
// Envio em lote em partes: um createMany/IN com dezenas de milhares de
// usuários estoura o limite de parâmetros do Postgres (65.535)
const BATCH_CHUNK = 1000;

@Injectable()
export class NotificationsService {
  private readonly logger = new SmartLogger('NotificationsService');

  constructor(private readonly prisma: PrismaService) {}

  async createNotification(data: CreateNotificationDto) {
    this.logger.log(`Creating notification for user ${data.userId}: ${data.title}`);
    try {
      const result = await this.prisma.userNotification.create({
        data: {
          userId: data.userId,
          title: data.title,
          message: data.message,
          type: data.type,
          actionUrl: data.actionUrl,
          actionText: data.actionText,
        },
      });
      this.logger.log(`Notification created successfully with ID: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Error creating notification: ${error.message}`);
      throw error;
    }
  }

  async getUserNotifications(userId: number, limit = 50) {
    limit = Math.min(Math.max(limit, 1), MAX_LIST);
    this.logger.log(`Getting notifications for user ${userId}, limit: ${limit}`);
    try {
      const result = await this.prisma.userNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      this.logger.log(`Found ${result.length} notifications for user ${userId}`);
      return result;
    } catch (error) {
      this.logger.error(`Error getting notifications: ${error.message}`);
      throw error;
    }
  }

  async getUnreadNotifications(userId: number) {
    this.logger.log(`Getting unread notifications for user ${userId}`);
    try {
      const result = await this.prisma.userNotification.findMany({
        where: {
          userId,
          isRead: false,
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_LIST,
      });
      this.logger.log(`Found ${result.length} unread notifications for user ${userId}`);
      return result;
    } catch (error) {
      this.logger.error(`Error getting unread notifications: ${error.message}`);
      throw error;
    }
  }

  async getNewNotifications(userId: number) {
    this.logger.log(`Getting new notifications for user ${userId}`);
    try {
      const result = await this.prisma.userNotification.findMany({
        where: {
          userId,
          isNew: true,
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_LIST,
      });
      this.logger.log(`Found ${result.length} new notifications for user ${userId}`);
      return result;
    } catch (error) {
      this.logger.error(`Error getting new notifications: ${error.message}`);
      throw error;
    }
  }

  async markAsRead(notificationId: number, userId: number) {
    this.logger.log(`Marking notification ${notificationId} as read for user ${userId}`);
    try {
      const result = await this.prisma.userNotification.updateMany({
        where: {
          id: notificationId,
          userId,
        },
        data: {
          isRead: true,
          isNew: false,
        },
      });
      this.logger.log(`Marked ${result.count} notifications as read`);
      return result;
    } catch (error) {
      this.logger.error(`Error marking notification as read: ${error.message}`);
      throw error;
    }
  }

  async markAllAsRead(userId: number) {
    this.logger.log(`Marking all notifications as read for user ${userId}`);
    try {
      const result = await this.prisma.userNotification.updateMany({
        where: { userId },
        data: {
          isRead: true,
          isNew: false,
        },
      });
      this.logger.log(`Marked ${result.count} notifications as read`);
      return result;
    } catch (error) {
      this.logger.error(`Error marking all notifications as read: ${error.message}`);
      throw error;
    }
  }

  async deleteNotification(notificationId: number, userId: number) {
    this.logger.log(`Deleting notification ${notificationId} for user ${userId}`);
    try {
      const result = await this.prisma.userNotification.deleteMany({
        where: {
          id: notificationId,
          userId,
        },
      });
      this.logger.log(`Deleted ${result.count} notifications`);
      return result;
    } catch (error) {
      this.logger.error(`Error deleting notification: ${error.message}`);
      throw error;
    }
  }

  async getNotificationCount(userId: number) {
    this.logger.log(`Getting notification count for user ${userId}`);
    try {
      const [unreadCount, newCount] = await Promise.all([
        this.prisma.userNotification.count({
          where: {
            userId,
            isRead: false,
          },
        }),
        this.prisma.userNotification.count({
          where: {
            userId,
            isNew: true,
          },
        }),
      ]);

      this.logger.log(`User ${userId}: unread=${unreadCount}, new=${newCount}`);
      return { unreadCount, newCount };
    } catch (error) {
      this.logger.error(`Error getting notification count: ${error.message}`);
      throw error;
    }
  }

  // Método para criar notificações em lote para múltiplos usuários
  async createNotificationsForUsers(
    userIds: number[],
    data: Omit<CreateNotificationDto, 'userId'>,
  ) {
    this.logger.log(`Creating notifications for ${userIds.length} users: ${data.title}`);
    try {
      // Pula quem já recebeu uma notificação com o mesmo título nos últimos
      // 5 minutos (evita duplicar num reenvio/duplo clique)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const uniqueIds = [...new Set(userIds)];
      let count = 0;
      for (let i = 0; i < uniqueIds.length; i += BATCH_CHUNK) {
        const chunk = uniqueIds.slice(i, i + BATCH_CHUNK);
        const existing = await this.prisma.userNotification.findMany({
          where: {
            userId: { in: chunk },
            title: data.title,
            createdAt: { gte: fiveMinutesAgo },
          },
          select: { userId: true },
        });
        const alreadyNotified = new Set(existing.map((n) => n.userId));
        const notifications = chunk
          .filter((userId) => !alreadyNotified.has(userId))
          .map((userId) => ({ ...data, userId }));
        if (notifications.length === 0) continue;
        const result = await this.prisma.userNotification.createMany({ data: notifications });
        count += result.count;
      }
      this.logger.log(`Created ${count} notifications for multiple users`);
      return { count };
    } catch (error) {
      this.logger.error(`Error creating notifications for users: ${error.message}`);
      throw error;
    }
  }

  // Método para buscar todas as notificações com dados dos usuários (admin)
  async getAllNotificationsWithUser(limit = 100) {
    this.logger.log(`Getting all notifications with user data, limit: ${limit}`);
    try {
      const result = await this.prisma.userNotification.findMany({
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              role: {
                select: {
                  name: true,
                },
              },
              isActive: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      // Transformar o objeto role para string (nome) para compatibilizar com o GraphQL;
      // NotificationUser.role é nullable, então uma role ausente/corrompida fica null
      // em vez de ser mascarada como um valor real (ver bug equivalente já corrigido
      // em BackofficeService.getRoleDistribution)
      const transformedResult = result.map((notification) => ({
        ...notification,
        user: {
          ...notification.user,
          role: notification.user.role?.name || null,
        },
      }));

      this.logger.log(`Found ${transformedResult.length} notifications with user data`);
      return transformedResult;
    } catch (error) {
      this.logger.error(`Error getting all notifications with user data: ${error.message}`);
      throw error;
    }
  }
}
