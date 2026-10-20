import { ActivityNotificationsService } from './activity-notifications.service';

describe('avisos de atividade', () => {
  it('gerente desativado e dono apagado não recebem e-mail nem sininho', async () => {
    const emails: string[] = [];
    const bells: number[] = [];
    const people = [
      account(1, 'dono@test.local', true, null),
      account(2, 'gerente@test.local', false, null),
      account(3, 'rede@test.local', true, new Date('2026-01-01')),
      account(4, 'gerente-ativo@test.local', true, null),
    ];
    const prisma = {
      sale: {
        findUnique: async () => ({
          barbershopId: 10,
          barberId: null,
          total: 40,
          customer: { name: 'Ana' },
          barber: null,
        }),
      },
      inventoryMovement: { findMany: async () => [] },
      barbershop: {
        findUnique: async () => ({
          id: 10,
          name: 'Unidade',
          timezone: 'America/Sao_Paulo',
          currency: 'BRL',
          ownerUserId: 1,
          network: { ownerUserId: 3 },
          barbers: [{ userId: 2 }, { userId: 4 }],
        }),
      },
      user: {
        findMany: async ({
          where,
        }: {
          where: { id: { in: number[] }; isActive?: boolean; deleted_at?: null };
        }) => {
          const activeOnly = where.isActive === true && where.deleted_at === null;
          expect(activeOnly).toBe(true);
          expect(where.id.in).toEqual(expect.arrayContaining([1, 2, 3, 4]));
          return people.filter(
            (user) => where.id.in.includes(user.id) && user.isActive && user.deleted_at === null,
          );
        },
      },
      userNotification: {
        createMany: async ({ data }: { data: { userId: number; message: string }[] }) => {
          bells.push(...data.map((row) => row.userId));
          expect(data.every((row) => row.message.includes('Ana'))).toBe(true);
          return { count: data.length };
        },
      },
    };
    const service = new ActivityNotificationsService(
      prisma as never,
      { notifyUsers: () => undefined } as never,
      {
        email: async (job: { to: string }) => {
          emails.push(job.to);
        },
      } as never,
      { get: () => 'https://app.test' } as never,
    );

    await service.saleCreated(7, null);

    expect(emails.sort()).toEqual(['dono@test.local', 'gerente-ativo@test.local']);
    expect(bells.sort()).toEqual([1, 4]);
  });
});

function account(id: number, email: string, isActive: boolean, deleted_at: Date | null) {
  return {
    id,
    email,
    fullName: email,
    isActive,
    deleted_at,
    notificationPreference: { salesEmail: true, salesInApp: true },
    userSystemConfig: { language: 'pt' },
  };
}
