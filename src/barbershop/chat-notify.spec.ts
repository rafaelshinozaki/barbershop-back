import { ChatService } from './chat.service';

describe('aviso de mensagem no sininho', () => {
  it('três mensagens seguidas deixam um aviso só', async () => {
    const rows: { id: number; userId: number; isRead: boolean; actionUrl: string; message: string }[] =
      [];
    const prisma = {
      barber: { findMany: async () => [] },
      user: {
        findMany: async () => [{ id: 3, userSystemConfig: { language: 'pt' } }],
      },
      userNotification: {
        findFirst: async ({ where }: { where: { userId: number; actionUrl: string } }) =>
          rows.find(
            (row) => row.userId === where.userId && !row.isRead && row.actionUrl === where.actionUrl,
          ) ?? null,
        create: async ({ data }: { data: { userId: number; actionUrl: string; message: string } }) => {
          const row = { id: rows.length + 1, isRead: false, ...data };
          rows.push(row);
          return row;
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: number };
          data: { message: string };
        }) => {
          const row = rows.find((item) => item.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        },
      },
    };
    const service = new ChatService(
      prisma as never,
      {} as never,
      {} as never,
      { notifyUsers: () => undefined } as never,
      {} as never,
      { sendToUsers: async () => undefined } as never,
    );
    const appt = {
      id: 9,
      customer: { name: 'Ana Silva' },
      barbershop: { id: 1, ownerUserId: 3 },
      barber: { userId: null },
    };
    const notify = (service as unknown as { notifyStaff: (a: unknown, k: string) => Promise<void> })
      .notifyStaff;
    await notify.call(service, appt, 'unit');
    await notify.call(service, appt, 'unit');
    await notify.call(service, appt, 'unit');
    expect(rows).toHaveLength(1);
    expect(rows[0].actionUrl).toBe('/messages?appointment=9');
  });
});
