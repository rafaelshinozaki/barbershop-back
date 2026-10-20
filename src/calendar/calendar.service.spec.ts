import { NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CalendarService } from './calendar.service';
import { UserService } from '../auth/users/users.service';

const token = 'link-secreto';
const tokenHash = createHash('sha256').update(token).digest('hex');

function appointment() {
  return {
    id: 9,
    startAt: new Date('2026-11-01T13:00:00Z'),
    endAt: new Date('2026-11-01T13:30:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    notes: null,
    customer: { name: 'Carlos', phone: '11987654321' },
    barber: { name: 'Ana' },
    services: [{ service: { name: 'Corte' } }],
  };
}

function build(opts?: {
  user?: { isActive: boolean; deleted_at: Date | null } | null;
  shop?: { platformSuspendedAt?: Date | null; network?: { platformSuspendedAt?: Date | null } };
}) {
  const findAppointments = jest.fn(async () => [appointment()]);
  const prisma = {
    calendarFeed: {
      findUnique: async () => ({
        id: 1,
        userId: 4,
        barbershopId: 7,
        scope: 'ALL',
        tokenHash,
        lastAccessAt: new Date(),
        barbershop: { name: 'Unidade', address: 'Rua 1', city: 'SP', state: 'SP' },
      }),
      update: async () => undefined,
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    user: {
      findUnique: async () =>
        opts?.user === undefined ? { isActive: true, deleted_at: null } : opts.user,
      findFirst: async () => ({ id: 4 }),
      update: async () => undefined,
      updateMany: async () => ({ count: 2 }),
    },
    appointment: { findMany: findAppointments },
    activeSession: {
      deleteMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    pushSubscription: { deleteMany: async () => ({ count: 0 }) },
    clientAccount: { updateMany: async () => undefined, findMany: async () => [] },
  };
  const shop = {
    accessLevel: 'owner',
    platformSuspendedAt: null,
    network: { platformSuspendedAt: null },
    ...opts?.shop,
  };
  const service = new CalendarService(prisma as never, {
    ensureAccess: async () => shop,
  } as never);
  const users = new UserService(
    prisma as never,
    {} as never,
    {} as never,
    { get: () => undefined } as never,
    {} as never,
  );
  return { service, users, prisma, findAppointments };
}

describe('agenda assinável: conta desativada e unidade suspensa', () => {
  it('entrega nome e telefone quando a conta e a unidade estão no ar', async () => {
    const { service, findAppointments } = build();
    const ics = await service.feedIcs(token);
    expect(findAppointments).toHaveBeenCalled();
    expect(ics).toContain('Telefone: 11987654321');
    expect(ics).toContain('Carlos');
  });

  it('responde 404 para conta inativa ou apagada, sem ler a agenda', async () => {
    for (const user of [
      { isActive: false, deleted_at: null },
      { isActive: true, deleted_at: new Date() },
      null,
    ]) {
      const { service, findAppointments } = build({ user });
      await expect(service.feedIcs(token)).rejects.toBeInstanceOf(NotFoundException);
      expect(findAppointments).not.toHaveBeenCalled();
    }
  });

  it('unidade ou rede suspensa não serve o feed', async () => {
    const suspended = new Date();
    for (const shop of [
      { platformSuspendedAt: suspended, network: { platformSuspendedAt: null } },
      { platformSuspendedAt: null, network: { platformSuspendedAt: suspended } },
    ]) {
      const { service, findAppointments } = build({ shop });
      await expect(service.feedIcs(token)).rejects.toBeInstanceOf(NotFoundException);
      expect(findAppointments).not.toHaveBeenCalled();
    }
  });

  it('desativar a conta e derrubar as sessões apagam o link', async () => {
    const { users, prisma } = build();
    await users.setUserActive(4, false);
    expect(prisma.calendarFeed.deleteMany).toHaveBeenCalledWith({ where: { userId: { in: [4] } } });

    prisma.calendarFeed.deleteMany.mockClear();
    await users.setUserActive(4, true);
    expect(prisma.calendarFeed.deleteMany).not.toHaveBeenCalled();

    await users.setMultipleUsersActive([4, 5], false);
    expect(prisma.calendarFeed.deleteMany).toHaveBeenCalledWith({
      where: { userId: { in: [4, 5] } },
    });

    prisma.calendarFeed.deleteMany.mockClear();
    await users.revokeAllSessions(4);
    expect(prisma.calendarFeed.deleteMany).toHaveBeenCalledWith({ where: { userId: { in: [4] } } });
  });
});
