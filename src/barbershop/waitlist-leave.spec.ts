import { BarbershopService } from './barbershop.service';
import { createWaitlistLeaveToken } from './appointment-link';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

type Row = {
  id: number;
  status: string;
  barbershopId: number;
  offeredStartAt: Date | null;
  offeredBarberId: number | null;
  offeredServiceIds: number[];
  notifiedAt: Date | null;
  barbershop: { name: string; timezone: string };
};

const future = new Date(Date.now() + 86_400_000);
const pastNotice = new Date(Date.now() - 31 * 60_000);

function match(value: unknown, expected: unknown): boolean {
  if (expected instanceof Date) {
    return value instanceof Date && value.getTime() === expected.getTime();
  }
  if (expected && typeof expected === 'object') {
    const filter = expected as { in?: unknown[]; gt?: Date; lte?: Date };
    if (filter.in) return filter.in.includes(value);
    if (filter.gt) return value instanceof Date && value > filter.gt;
    if (filter.lte) return value instanceof Date && value <= filter.lte;
    return false;
  }
  return value === expected;
}

function matches(row: Row, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) =>
    match(row[key as keyof Row], expected),
  );
}

function build(slotTaken = false) {
  const entries = new Map<number, Row>();
  const passed: Date[] = [];
  const copy = (row: Row): Row => ({
    ...row,
    offeredServiceIds: [...row.offeredServiceIds],
    barbershop: { ...row.barbershop },
  });
  const service = Object.create(BarbershopService.prototype) as BarbershopService;
  Object.assign(service, {
    prisma: {
      waitlistEntry: {
        findUnique: async ({ where }: { where: { id: number } }) => {
          const row = entries.get(where.id);
          return row ? copy(row) : null;
        },
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          [...entries.values()].filter((row) => matches(row, where)).map(copy),
        updateMany: async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<Row>;
        }) => {
          let count = 0;
          for (const row of entries.values()) {
            if (!matches(row, where)) continue;
            Object.assign(row, data);
            count++;
          }
          return { count };
        },
      },
      appointment: {
        findFirst: async () => (slotTaken ? { id: 1 } : null),
      },
    },
    realtime: { notify: () => undefined },
    logger: { error: () => undefined },
    checkWaitlistOnCancellation: async (
      _barbershopId: number,
      appointment: { startAt: Date; barberId: number },
    ) => {
      passed.push(appointment.startAt);
      const next = [...entries.values()].find((row) => row.status === 'WAITING');
      if (!next) return;
      next.status = 'NOTIFIED';
      next.notifiedAt = new Date();
      next.offeredStartAt = appointment.startAt;
      next.offeredBarberId = appointment.barberId;
    },
  });
  return { service, entries, passed };
}

describe('sair da lista depois do aviso', () => {
  it('cancela quem já foi avisado, passa a vaga na hora e o prazo não devolve a entrada', async () => {
    const { service, entries, passed } = build();
    entries.set(1, {
      id: 1,
      status: 'NOTIFIED',
      barbershopId: 3,
      offeredStartAt: future,
      offeredBarberId: 4,
      offeredServiceIds: [9],
      notifiedAt: pastNotice,
      barbershop: { name: 'Barbearia Espera', timezone: 'America/Sao_Paulo' },
    });
    entries.set(2, {
      id: 2,
      status: 'WAITING',
      barbershopId: 3,
      offeredStartAt: null,
      offeredBarberId: null,
      offeredServiceIds: [],
      notifiedAt: null,
      barbershop: { name: 'Barbearia Espera', timezone: 'America/Sao_Paulo' },
    });

    expect(await service.leaveWaitlist(createWaitlistLeaveToken(1))).toBe('Barbearia Espera');
    expect(entries.get(1)?.status).toBe('CANCELLED');
    expect(entries.get(2)?.status).toBe('NOTIFIED');
    expect(entries.get(2)?.offeredStartAt).toEqual(future);
    expect(passed).toEqual([future]);

    entries.get(2)!.notifiedAt = pastNotice;
    await service.passExpiredWaitlistOffers();
    expect(entries.get(1)?.status).toBe('CANCELLED');
    expect(entries.get(2)?.status).toBe('WAITING');
  });

  it('horário já marcado não é oferecido de novo', async () => {
    const { service, entries, passed } = build(true);
    entries.set(1, {
      id: 1,
      status: 'NOTIFIED',
      barbershopId: 3,
      offeredStartAt: future,
      offeredBarberId: 4,
      offeredServiceIds: [9],
      notifiedAt: pastNotice,
      barbershop: { name: 'Barbearia Espera', timezone: 'America/Sao_Paulo' },
    });
    await service.leaveWaitlist(createWaitlistLeaveToken(1));
    expect(entries.get(1)?.status).toBe('CANCELLED');
    expect(passed).toEqual([]);
  });
});
