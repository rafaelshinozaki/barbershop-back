import { ForbiddenException } from '@nestjs/common';
import { BarbershopService, PLATFORM_SUSPENDED_BOOKING_MESSAGE } from './barbershop.service';

function serviceWith(extra: Record<string, unknown>) {
  const service = Object.create(BarbershopService.prototype) as BarbershopService;
  Object.assign(service, extra);
  return service;
}

const booking = {
  barbershopId: 3,
  serviceIds: [1],
  startAt: 'não é data',
  customerName: 'Ana',
  customerPhone: '11999990000',
  customerEmail: 'ana@test.local',
};

describe('conta suspensa pela plataforma na página pública', () => {
  it('recusa o agendamento pelo e-mail da conta e não segue', async () => {
    const followed = jest.fn();
    const service = serviceWith({
      publicServices: followed,
      prisma: {
        barbershop: { findFirst: async () => ({ id: 3, networkId: 1 }) },
        customer: { findFirst: async () => null },
        clientAccount: { findFirst: async () => ({ id: 9 }) },
        $queryRaw: async () => [],
      },
    });
    await expect(service.createPublicAppointment(booking)).rejects.toThrow(
      new ForbiddenException(PLATFORM_SUSPENDED_BOOKING_MESSAGE),
    );
    expect(followed).not.toHaveBeenCalled();
  });

  it('recusa pelo telefone da conta, mesmo sem o e-mail', async () => {
    let raw = 0;
    const service = serviceWith({
      publicServices: () => {
        throw new Error('não devia seguir');
      },
      prisma: {
        barbershop: { findFirst: async () => ({ id: 3, networkId: 1 }) },
        customer: { findFirst: async () => null },
        clientAccount: { findFirst: async () => null },
        $queryRaw: async () => {
          raw += 1;
          // a primeira é o bloqueio da unidade; a segunda é a conta suspensa
          return raw === 1 ? [] : [{ id: 9 }];
        },
      },
    });
    await expect(
      service.createPublicAppointment({ ...booking, customerEmail: undefined }),
    ).rejects.toThrow(new ForbiddenException(PLATFORM_SUSPENDED_BOOKING_MESSAGE));
  });

  it('não remarca pelo link e o cancelamento pelo link continua', async () => {
    const updates: string[] = [];
    const loaded = {
      appt: {
        id: 9,
        status: 'CONFIRMED',
        barbershopId: 3,
        barberId: 4,
        customer: { phone: '11988887777', email: 'ana@test.local', clientAccountId: 2 },
        barbershop: { networkId: 1 },
        services: [{ service: { id: 1 } }],
      },
      canChange: true,
      readOnly: false,
      windowHours: 24,
      changeDeadline: new Date(Date.now() + 86_400_000),
    };
    const service = serviceWith({
      loadManagedAppointment: async () => loaded,
      checkWaitlistOnCancellation: async () => undefined,
      prisma: {
        customer: { findFirst: async () => null },
        clientAccount: { findFirst: async () => ({ id: 2 }) },
        $queryRaw: async () => [],
        appointment: {
          updateMany: async () => {
            updates.push('cancel');
            return { count: 1 };
          },
        },
        barber: {
          findFirst: async () => {
            throw new Error('não devia procurar horário');
          },
        },
      },
    });
    await expect(
      service.rescheduleManagedAppointment('token', '2026-11-01T15:00:00'),
    ).rejects.toThrow(new ForbiddenException(PLATFORM_SUSPENDED_BOOKING_MESSAGE));
    expect(updates).toEqual([]);
    await service.cancelManagedAppointment('token');
    expect(updates).toEqual(['cancel']);
  });
});
