import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';
import { ProfessionalReviewService } from './professional-review.service';
import { ScheduleService } from './schedule.service';
import { appointmentLinkMode, createAppointmentToken } from './appointment-link';

process.env.JWT_SECRET ??= 'round-318-325';

const logger = { log: () => undefined, warn: () => undefined, error: () => undefined };

describe('gerente e o vínculo (318)', () => {
  const barber = {
    id: 4,
    userId: 7,
    staffType: 'manager',
    isActive: true,
    takesAppointments: null,
    accessStartsAt: null as Date | null,
    accessEndsAt: new Date('2026-12-31T00:00:00Z'),
    avatarHiddenAt: null,
    avatarKey: null,
    avatarUrl: null,
    name: 'Rita',
  };

  function service(accessLevel: 'owner' | 'manager') {
    const update = jest.fn(async () => ({ ...barber, accessEndsAt: null }));
    const shop = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(shop, {
      ensureBarbershopAccess: async () => ({
        accessLevel,
        ownerUserId: 1,
        id: 2,
      }),
      prisma: { barber: { findFirst: async () => ({ ...barber }), update } },
    });
    return { shop, update };
  }

  it('o gerente não apaga o próprio prazo; o dono apaga', async () => {
    const manager = service('manager');
    await expect(manager.shop.updateBarber(7, 2, 4, { accessEndsAt: null })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(manager.update).not.toHaveBeenCalled();

    const owner = service('owner');
    await owner.shop.updateBarber(1, 2, 4, { accessEndsAt: null });
    expect(owner.update).toHaveBeenCalled();

    const nameOnly = service('manager');
    await nameOnly.shop.updateBarber(7, 2, 4, { name: 'Rita Souza' });
    expect(nameOnly.update).toHaveBeenCalled();
  });
});

describe('avaliação às cegas (319)', () => {
  it('não aparece na página e não aceita resposta até a nota do profissional', async () => {
    const reviews = Object.create(ProfessionalReviewService.prototype) as ProfessionalReviewService;
    const captured: Array<Record<string, unknown>> = [];
    const update = jest.fn();
    Object.assign(reviews, {
      prisma: {
        professionalReview: {
          findMany: async ({ where }: { where: Record<string, unknown> }) => {
            captured.push(where);
            return [];
          },
          findFirst: async () => ({
            id: 3,
            appointment: { endAt: new Date(), source: 'ONLINE', customerRatings: [] },
          }),
          update,
        },
      },
    });
    expect(await reviews.publicReviews(9)).toEqual([]);
    expect(captured[0].appointment).toBeTruthy();
    await expect(reviews.reply(1, 3, 'Obrigado')).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('troca de cliente e horário cancelado (321 e 323)', () => {
  const start = new Date(Date.now() + 3 * 86_400_000);
  const end = new Date(start.getTime() + 3_600_000);

  function shop() {
    const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 5,
      status: data.status ?? 'CONFIRMED',
      startAt: start,
      customer: { name: 'Novo', email: 'novo@x.com' },
      contactEmail: data.contactEmail ?? null,
      services: [],
      barber: { name: 'Ana' },
    }));
    const ensureBarberAvailable = jest.fn(async () => undefined);
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      logger,
      ensureBarbershopAccess: async () => ({ networkId: 1, accessLevel: 'owner' }),
      ownBarberIdIfBarber: async () => null,
      ensureOwnAppointment: () => undefined,
      ensureCustomerOfNetwork: async () => undefined,
      lockSchedule: async () => undefined,
      ensureBarberAvailable,
      recordNoShowFee: async () => null,
      contactVisibility: async () => true,
      hideAppointmentContact: (_can: unknown, row: unknown) => row,
      sendAppointmentEmail: jest.fn(async () => undefined),
      prisma: {
        sale: { findFirst: async () => null },
        appointment: {
          findFirst: async () => ({
            id: 5,
            customerId: 1,
            barberId: 3,
            resourceId: null,
            startAt: start,
            endAt: end,
            status: 'CONFIRMED',
            depositPaidAt: null,
            prepaidAt: null,
            linkVersion: 1,
          }),
        },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({ appointment: { update } }),
      },
    });
    return { service, update, ensureBarberAvailable };
  }

  it('sinal pago online não troca de cliente; a troca invalida o link antigo', async () => {
    const blocked = shop();
    (
      blocked.service as unknown as {
        prisma: { appointment: { findFirst: () => Promise<unknown> } };
      }
    ).prisma.appointment.findFirst = async () => ({
      id: 5,
      customerId: 1,
      barberId: 3,
      startAt: start,
      endAt: end,
      status: 'CONFIRMED',
      depositPaidAt: new Date(),
      prepaidAt: null,
    });
    await expect(blocked.service.updateAppointment(1, 2, 5, { customerId: 2 })).rejects.toThrow(
      'Não dá para trocar o cliente',
    );

    const open = shop();
    await open.service.updateAppointment(1, 2, 5, { customerId: 2 });
    expect(open.update.mock.calls[0][0].data.linkVersion).toEqual({ increment: 2 });
    expect(
      appointmentLinkMode(createAppointmentToken(5, 1), 'appointment-manage', {
        id: 5,
        endAt: end,
        linkVersion: 3,
      }),
    ).toBeNull();
    expect(
      (open.service as unknown as { sendAppointmentEmail: jest.Mock }).sendAppointmentEmail,
    ).toHaveBeenCalled();
  });

  it('cancelado com a vaga ocupada muda a observação e vira falta, e não volta a confirmado', async () => {
    const service = shop();
    const past = new Date(Date.now() - 3_600_000);
    (
      service.service as unknown as {
        prisma: { appointment: { findFirst: () => Promise<unknown> } };
      }
    ).prisma.appointment.findFirst = async () => ({
      id: 5,
      customerId: 1,
      barberId: 3,
      resourceId: null,
      startAt: past,
      endAt: new Date(Date.now() - 60_000),
      status: 'CANCELLED',
      depositPaidAt: null,
      prepaidAt: null,
    });
    service.update.mockImplementation((async ({ data }: { data: { status?: string } }) => ({
      id: 5,
      status: data.status ?? 'CANCELLED',
      startAt: past,
      customer: { name: 'Ana', email: null },
      contactEmail: null,
      services: [],
      barber: { name: 'Leo' },
    })) as never);
    service.ensureBarberAvailable.mockImplementation(async () => {
      throw new BadRequestException('Este profissional já tem um agendamento nesse horário');
    });
    await service.service.updateAppointment(1, 2, 5, { notes: 'cliente avisou' });
    await service.service.updateAppointment(1, 2, 5, { status: 'NO_SHOW' });
    expect(service.ensureBarberAvailable).not.toHaveBeenCalled();
    await expect(
      service.service.updateAppointment(1, 2, 5, { status: 'CONFIRMED' }),
    ).rejects.toThrow('Este profissional já tem um agendamento nesse horário');
  });
});

describe('lista de espera (324)', () => {
  it('vaga ocupada pela remarcação não avisa, e a equipe passa a vaga ao próximo', async () => {
    const findMany = jest.fn();
    const passed: unknown[] = [];
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    const start = new Date('2026-11-02T13:00:00Z');
    Object.assign(service, {
      logger,
      realtime: { notify: () => undefined },
      ensureBarbershopAccess: async () => ({ id: 2 }),
      ensurePublicSlot: async () => ({
        startAt: start,
        endAt: new Date(start.getTime() + 3_600_000),
      }),
      ensureBarberAvailable: async () => {
        throw new BadRequestException('Este profissional já tem um agendamento nesse horário');
      },
      prisma: {
        barbershop: {
          findFirst: async () => ({ timezone: 'America/Sao_Paulo', minBookingLeadMinutes: 0 }),
        },
        waitlistEntry: { findMany },
      },
    });
    await service.checkWaitlistOnCancellation(2, {
      startAt: start,
      endAt: new Date(start.getTime() + 3_600_000),
      barberId: 3,
      services: [{ serviceId: 1 }],
    });
    expect(findMany).not.toHaveBeenCalled();

    const offer = new Date(Date.now() + 86_400_000);
    Object.assign(service, {
      passWaitlistOffer: async (entry: unknown) => {
        passed.push(entry);
        return 'passed';
      },
      prisma: {
        waitlistEntry: {
          findFirst: async () => ({
            id: 9,
            status: 'NOTIFIED',
            offeredStartAt: offer,
            offeredBarberId: 3,
            offeredServiceIds: [1],
            barbershopId: 2,
            barbershop: { timezone: 'America/Sao_Paulo' },
          }),
          updateMany: async () => ({ count: 1 }),
          findUniqueOrThrow: async () => ({ id: 9, status: 'CANCELLED' }),
        },
      },
    });
    await service.cancelWaitlistEntry(1, 2, 9);
    expect(passed).toHaveLength(1);
  });
});

describe('horários fora do expediente (325)', () => {
  it('sábado depois dos 500 primeiros aparece no aviso', async () => {
    const monday = new Date('2026-11-02T13:00:00Z');
    const saturday = new Date('2026-11-07T13:00:00Z');
    const row = (id: number, startAt: Date) => ({
      id,
      startAt,
      endAt: new Date(startAt.getTime() + 3_600_000),
      barberId: 3,
      contactEmail: null,
      customer: { name: 'Ana', email: null },
      barber: { name: 'Leo' },
    });
    let calls = 0;
    const schedules = Object.create(ScheduleService.prototype) as ScheduleService;
    Object.assign(schedules, {
      prisma: {
        barbershop: { findUnique: async () => ({ timezone: 'America/Sao_Paulo' }) },
        barbershopClosure: { findMany: async () => [] },
        appointment: {
          findMany: async () => {
            calls += 1;
            if (calls === 1) return Array.from({ length: 500 }, (_, i) => row(i + 1, monday));
            return Array.from({ length: 100 }, (_, i) => row(501 + i, saturday));
          },
        },
      },
    });
    const impact = await (
      schedules as unknown as {
        outside: (
          shopId: number,
          barberId: number | null,
          windowFor: (barberId: number, day: number) => { start: string; end: string } | null,
        ) => Promise<Array<{ id: number }>>;
      }
    ).outside(2, null, (_barberId, day) => (day === 6 ? null : { start: '08:00', end: '20:00' }));
    expect(impact.map((item) => item.id)).toContain(501);
    expect(impact).toHaveLength(100);
    expect(calls).toBe(2);
  });
});
