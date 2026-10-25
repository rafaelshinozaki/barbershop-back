import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { SmartLogger } from '../common/logger.util';
import { RealtimeService } from '../realtime/realtime.service';
import { normalizeLang, type Lang } from '../email/language';

// Teto das listas do sininho (antes "não lidas" e "novas" não tinham limite)
const MAX_LIST = 100;
// Envio em lote em partes: um createMany/IN com dezenas de milhares de
// usuários estoura o limite de parâmetros do Postgres (65.535)
const BATCH_CHUNK = 1000;

export type InAppPreference =
  | 'newsInApp'
  | 'promotionsInApp'
  | 'securityInApp'
  | 'instabilityInApp'
  | 'appointmentsInApp'
  | 'salesInApp'
  | 'inventoryInApp'
  | 'teamInApp'
  | 'reviewsInApp';

export type LocalizedNotice = Record<Lang, { title: string; message: string }>;

@Injectable()
export class NotificationsService {
  private readonly logger = new SmartLogger('NotificationsService');

  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeService) {}

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
      this.realtime.notifyUsers([data.userId], 'CREATED', data.title);
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
      if (result.count > 0) this.realtime.notifyUsers([userId], 'READ');
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
      if (result.count > 0) this.realtime.notifyUsers([userId], 'READ');
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
      if (result.count > 0) this.realtime.notifyUsers([userId], 'DELETED');
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

  // Método para criar notificações em lote para múltiplos usuários.
  // Com `localized`, cada pessoa recebe no idioma da conta. Com `inApp`,
  // quem desligou essa categoria no sininho não recebe. Os dois avisam na
  // hora quem está com a tela aberta.
  async createNotificationsForUsers(
    userIds: number[],
    data: Omit<CreateNotificationDto, 'userId'> & { localized?: LocalizedNotice },
    options?: { inApp?: InAppPreference },
  ) {
    const logTitle = data.localized?.pt.title ?? data.title;
    this.logger.log(`Creating notifications for ${userIds.length} users: ${logTitle}`);
    try {
      if (data.localized || options?.inApp) {
        return await this.createLocalized(userIds, data, options?.inApp);
      }
      // Pula quem já recebeu o mesmo aviso (título e mensagem) nos últimos 5
      // minutos: evita duplicar num reenvio ou duplo clique. Só o título
      // juntava dois eventos diferentes do mesmo tipo (item 268)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const uniqueIds = [...new Set(userIds)];
      const delivered: number[] = [];
      let count = 0;
      for (let i = 0; i < uniqueIds.length; i += BATCH_CHUNK) {
        const chunk = uniqueIds.slice(i, i + BATCH_CHUNK);
        const existing = await this.prisma.userNotification.findMany({
          where: {
            userId: { in: chunk },
            title: data.title,
            message: data.message,
            createdAt: { gte: fiveMinutesAgo },
          },
          select: { userId: true },
        });
        const alreadyNotified = new Set(existing.map((n) => n.userId));
        const notifications = chunk
          .filter((userId) => !alreadyNotified.has(userId))
          .map((userId) => {
            const { localized: _localized, ...rest } = data;
            return { ...rest, userId };
          });
        if (notifications.length === 0) continue;
        const result = await this.prisma.userNotification.createMany({ data: notifications });
        count += result.count;
        delivered.push(...notifications.map((n) => n.userId));
        this.realtime.notifyUsers(
          notifications.map((n) => n.userId),
          'CREATED',
          data.title,
        );
      }
      this.logger.log(`Created ${count} notifications for multiple users`);
      // Só quem recebeu agora (o celular não repete o aviso descartado)
      return { count, userIds: delivered };
    } catch (error) {
      this.logger.error(`Error creating notifications for users: ${error.message}`);
      throw error;
    }
  }

  private async createLocalized(
    userIds: number[],
    data: Omit<CreateNotificationDto, 'userId'> & { localized?: LocalizedNotice },
    inApp?: InAppPreference,
  ) {
    const uniqueIds = [...new Set(userIds)].filter((id) => Number.isInteger(id));
    if (!uniqueIds.length) return { count: 0, userIds: [] };
    const localized = data.localized;
    const titles = localized
      ? (['pt', 'en', 'es'] as const).map((lang) => localized[lang].title)
      : [data.title];
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds }, isActive: true, deleted_at: null },
      select: {
        id: true,
        userSystemConfig: { select: { language: true } },
        notificationPreference: true,
      },
    });
    // Mesmo aviso = mesmo título e mesma mensagem (item 268)
    const existing = await this.prisma.userNotification.findMany({
      where: {
        userId: { in: uniqueIds },
        title: { in: titles },
        createdAt: { gte: fiveMinutesAgo },
      },
      select: { userId: true, title: true, message: true },
    });
    const already = new Set(existing.map((row) => `${row.userId}:${row.title}:${row.message}`));
    const rows: {
      userId: number;
      title: string;
      message: string;
      type: CreateNotificationDto['type'];
      actionUrl?: string;
      actionText?: string;
    }[] = [];
    for (const user of users) {
      const pref = user.notificationPreference as Record<string, boolean | null> | null;
      if (inApp && pref && pref[inApp] === false) continue;
      const lang = normalizeLang(user.userSystemConfig?.language);
      const text = localized ? localized[lang] : { title: data.title, message: data.message };
      if (already.has(`${user.id}:${text.title}:${text.message}`)) continue;
      rows.push({
        userId: user.id,
        title: text.title,
        message: text.message,
        type: data.type,
        actionUrl: data.actionUrl,
        actionText: data.actionText,
      });
    }
    if (rows.length) {
      await this.prisma.userNotification.createMany({ data: rows });
      const byTitle = new Map<string, number[]>();
      for (const row of rows) {
        byTitle.set(row.title, [...(byTitle.get(row.title) ?? []), row.userId]);
      }
      for (const [title, ids] of byTitle) this.realtime.notifyUsers(ids, 'CREATED', title);
    }
    const notified = rows.map((row) => row.userId);
    this.logger.log(`Created ${rows.length} notifications for multiple users`);
    return { count: rows.length, userIds: notified };
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
