import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BarbershopService, CLUB_CANCEL_FAILED_MESSAGE } from './barbershop.service';

const BLOCKED = 'Não é possível agendar online nesta unidade. Fale diretamente com a unidade.';

function serviceWith(extra: Record<string, unknown>) {
  const service = Object.create(BarbershopService.prototype) as BarbershopService;
  Object.assign(service, extra);
  return service;
}

describe('cliente bloqueado no clube e no link', () => {
  it('não assina o clube e não chega no Stripe', async () => {
    const createSubscription = jest.fn();
    const service = serviceWith({
      prisma: {
        clientAccount: {
          findUnique: async () => ({
            id: 2,
            stripeCustomerId: 'cus_1',
            email: 'ana@test.local',
            phone: '11999990000',
          }),
        },
        clientSubscriptionPlan: {
          findFirst: async () => ({
            id: 8,
            stripePriceId: 'price_1',
            service: { isActive: true },
          }),
        },
        barbershop: { findFirst: async () => ({ id: 3, networkId: 1 }) },
        customer: {
          findMany: async () => [{ phone: '11988887777', email: 'ficha@test.local' }],
          findFirst: async () => ({ id: 5 }),
        },
        $queryRaw: async () => [],
      },
      stripeService: { createSubscription },
    });
    await expect(service.subscribeToPlan(2, 3, 8, 'pm_1')).rejects.toThrow(BLOCKED);
    expect(createSubscription).not.toHaveBeenCalled();
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
        customer: { findFirst: async () => ({ id: 5 }) },
        $queryRaw: async () => [{ id: 5 }],
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
    await expect(service.rescheduleManagedAppointment('token', '2026-11-01T15:00:00')).rejects.toThrow(
      new ForbiddenException(BLOCKED),
    );
    expect(updates).toEqual([]);
    await service.cancelManagedAppointment('token');
    expect(updates).toEqual(['cancel']);
  });

  it('ao bloquear, mostra clube e pacote com saldo e cancela com estorno se a unidade pedir', async () => {
    const customer = {
      id: 5,
      networkId: 1,
      phone: '11999990000',
      email: 'ana@test.local',
      clientAccountId: 4,
      blockedAt: null as Date | null,
    };
    const stripe = {
      cancelSubscription: jest.fn(async () => undefined),
      updateSubscription: jest.fn(async () => undefined),
    };
    const refunds: number[] = [];
    const subUpdates: Record<string, unknown>[] = [];
    let packageCustomers: number[] = [];
    const service = serviceWith({
      ensureBarbershopAccess: async () => ({ id: 3, networkId: 1 }),
      customerIdsByPhone: async () => [6],
      contactVisibility: async () => ({}),
      hideContact: async (_visibility: unknown, row: typeof customer) => row,
      unusedClubCycles: async () => [
        { subscriptionId: 7, amount: 12.5, currency: 'BRL', connected: false, payment: { id: 1 } },
      ],
      refundUnusedClubCycle: async (refund: { amount: number }) => {
        refunds.push(refund.amount);
      },
      logger: { error: () => undefined },
      stripeService: stripe,
      prisma: {
        customer: {
          findFirst: async () => customer,
          findMany: async () => [{ id: 8 }],
          update: async ({ data }: { data: { blockedAt?: Date | null } }) => ({
            ...customer,
            ...data,
          }),
        },
        clientSubscription: {
          findMany: async () => [
            {
              id: 7,
              status: 'ACTIVE',
              stripeSubscriptionId: 'sub_1',
              barbershopId: 3,
              plan: { name: 'Corte mensal' },
              barbershop: { id: 3, name: 'Centro', currency: 'BRL' },
            },
          ],
          update: async ({ data }: { data: Record<string, unknown> }) => {
            subUpdates.push(data);
            return data;
          },
        },
        clientPackage: {
          findMany: async ({ where }: { where: { customerId: { in: number[] } } }) => {
            packageCustomers = where.customerId.in;
            return [
              {
                totalSessions: 4,
                usedSessions: 1,
                expiresAt: null,
                servicePackage: { name: 'Pacote' },
                barbershop: { name: 'Centro' },
              },
              {
                totalSessions: 4,
                usedSessions: 4,
                expiresAt: null,
                servicePackage: { name: 'Acabou' },
                barbershop: { name: 'Centro' },
              },
            ];
          },
        },
      },
    });

    const preview = await service.customerBlockPreview(1, 3, 5);
    expect(preview.subscriptions).toEqual([
      {
        id: 7,
        planName: 'Corte mensal',
        barbershopName: 'Centro',
        currency: 'BRL',
        refundAmount: 12.5,
      },
    ]);
    expect(preview.packages).toEqual([{ name: 'Pacote', remaining: 3, barbershopName: 'Centro' }]);
    expect(packageCustomers).toEqual(expect.arrayContaining([5, 6, 8]));

    await service.setCustomerBlocked(1, 3, 5, true, 'sumiu', {
      cancelSubscriptions: true,
      refundUnused: true,
    });
    expect(stripe.cancelSubscription).toHaveBeenCalledWith('sub_1');
    expect(stripe.updateSubscription).not.toHaveBeenCalled();
    expect(subUpdates[0]).toMatchObject({ status: 'CANCELED', cancelAtPeriodEnd: false });
    expect(refunds).toEqual([12.5]);

    stripe.cancelSubscription.mockClear();
    subUpdates.length = 0;
    refunds.length = 0;
    await service.setCustomerBlocked(1, 3, 5, true, null, { cancelSubscriptions: true });
    expect(stripe.updateSubscription).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    expect(stripe.cancelSubscription).not.toHaveBeenCalled();
    expect(refunds).toEqual([]);

    stripe.updateSubscription.mockRejectedValueOnce(new Error('stripe fora'));
    await expect(
      service.setCustomerBlocked(1, 3, 5, true, null, { cancelSubscriptions: true }),
    ).rejects.toThrow(new BadRequestException(CLUB_CANCEL_FAILED_MESSAGE));
  });
});
