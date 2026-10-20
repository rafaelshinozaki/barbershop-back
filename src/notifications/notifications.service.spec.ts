import { NotificationType } from './dto/create-notification.dto';
import { NotificationsService } from './notifications.service';
import { moderationNotice, ModerationService } from '../barbershop/moderation.service';

describe('sininho: idioma, preferência e aviso na hora', () => {
  it('grava no idioma da conta, avisa na hora e pula quem desligou a categoria', async () => {
    const created: { userId: number; title: string; message: string }[] = [];
    const notified: unknown[] = [];
    const people = [
      {
        id: 1,
        isActive: true,
        deleted_at: null,
        userSystemConfig: { language: 'en' },
        notificationPreference: { securityInApp: true },
      },
      {
        id: 2,
        isActive: true,
        deleted_at: null,
        userSystemConfig: { language: 'en' },
        notificationPreference: { securityInApp: false },
      },
      {
        id: 3,
        isActive: true,
        deleted_at: null,
        userSystemConfig: { language: 'es' },
        notificationPreference: null,
      },
      {
        id: 4,
        isActive: false,
        deleted_at: null,
        userSystemConfig: { language: 'en' },
        notificationPreference: { securityInApp: true },
      },
    ];
    const prisma = {
      user: {
        findMany: async ({
          where,
        }: {
          where: { id: { in: number[] }; isActive?: boolean; deleted_at?: null };
        }) => {
          const activeOnly = where.isActive === true && where.deleted_at === null;
          return people.filter(
            (user) =>
              where.id.in.includes(user.id) &&
              (!activeOnly || (user.isActive && user.deleted_at === null)),
          );
        },
      },
      userNotification: {
        findMany: async () => [],
        createMany: async ({ data }: { data: typeof created }) => {
          created.push(...data);
          return { count: data.length };
        },
      },
    };
    const service = new NotificationsService(prisma as never, {
      notifyUsers: (...args: unknown[]) => notified.push(args),
    } as never);
    const localized = moderationNotice('photo', true, 'Loja');
    const result = await service.createNotificationsForUsers(
      [1, 2, 3, 4],
      {
        title: localized!.pt.title,
        message: localized!.pt.message,
        type: NotificationType.INFO,
        localized: localized!,
      },
      { inApp: 'securityInApp' },
    );
    expect(result.userIds).toEqual([1, 3]);
    expect(created.map((row) => [row.userId, row.title])).toEqual([
      [1, 'Photo hidden by moderation'],
      [3, 'Foto ocultada por la moderación'],
    ]);
    expect(notified).toEqual([
      [[1], 'CREATED', 'Photo hidden by moderation'],
      [[3], 'CREATED', 'Foto ocultada por la moderación'],
    ]);
  });

  it('unidade fora da busca e perfil suspenso saem em inglês e espanhol', () => {
    expect(moderationNotice('barbershop', true, 'Loja')?.en.title).toBe(
      'Location removed from search',
    );
    expect(moderationNotice('professional_profile', false)?.es.message).toBe(
      'Tu página pública volvió al aire.',
    );
  });
});

describe('ModerationService.notifyOwner', () => {
  it('usa o caminho do sininho, não grava direto', async () => {
    const create = jest.fn(async () => ({ count: 1, userIds: [4] }));
    const prisma = {
      barbershopPhoto: { findUnique: async () => ({ barbershopId: 3 }) },
      barbershop: {
        findUnique: async () => ({
          name: 'Loja',
          ownerUserId: 4,
          network: { ownerUserId: null },
          barbers: [],
        }),
      },
    };
    const moderation = new ModerationService(
      prisma as never,
      {} as never,
      undefined,
      { createNotificationsForUsers: create } as never,
    );
    await moderation.notifyOwner('photo', 9, 'hide');
    expect(create).toHaveBeenCalledWith(
      [4],
      expect.objectContaining({
        localized: expect.objectContaining({
          en: expect.objectContaining({ title: 'Photo hidden by moderation' }),
        }),
      }),
      { inApp: 'securityInApp' },
    );
  });
});
