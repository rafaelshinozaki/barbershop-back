import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { SmartLogger } from '../common/logger.util';

export interface UpdateNotificationDto {
  isRead?: boolean;
  isNew?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly smartLogger = new SmartLogger('NotificationsService');

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
    this.smartLogger.log(`Getting notification count for user ${userId}`);
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

      this.smartLogger.log(`User ${userId}: unread=${unreadCount}, new=${newCount}`);
      return { unreadCount, newCount };
    } catch (error) {
      this.smartLogger.error(`Error getting notification count`, error);
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
      // Buscar notificações já existentes para esses usuários com o mesmo título nos últimos 5 minutos
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const existing = await this.prisma.userNotification.findMany({
        where: {
          userId: { in: userIds },
          title: data.title,
          createdAt: { gte: fiveMinutesAgo },
        },
        select: { userId: true },
      });
      const alreadyNotified = new Set(existing.map((n) => n.userId));
      const notifications = userIds
        .filter((userId) => !alreadyNotified.has(userId))
        .map((userId) => ({
          ...data,
          userId,
        }));

      if (notifications.length === 0) {
        this.logger.log('No new notifications to create (all already exist)');
        return { count: 0 };
      }

      const result = await this.prisma.userNotification.createMany({
        data: notifications,
      });
      this.logger.log(`Created ${result.count} notifications for multiple users`);
      return result;
    } catch (error) {
      this.logger.error(`Error creating notifications for users: ${error.message}`);
      throw error;
    }
  }

  // Método para criar notificação para todos os usuários ativos
  async createNotificationForAllActiveUsers(data: Omit<CreateNotificationDto, 'userId'>) {
    this.logger.log(`Creating notifications for all active users: ${data.title}`);
    try {
      // Buscar todos os usuários ativos
      const activeUsers = await this.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      const userIds = activeUsers.map((user) => user.id);
      this.logger.log(`Found ${userIds.length} active users`);
      return this.createNotificationsForUsers(userIds, data);
    } catch (error) {
      this.logger.error(`Error creating notifications for all users: ${error.message}`);
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

      // Transformar o objeto role para string (nome) para compatibilizar com o GraphQL
      const transformedResult = result.map((notification) => ({
        ...notification,
        user: {
          ...notification.user,
          role: notification.user.role?.name || 'BarbershopOwner',
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
