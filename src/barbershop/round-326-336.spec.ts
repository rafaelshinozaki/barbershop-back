import { BadRequestException } from '@nestjs/common';
import {
  BarbershopService,
  DEPOSIT_RECEIVED_DELETE_MESSAGE,
  engagementStrandedMessage,
  sameShopMonth,
} from './barbershop.service';
import { DepositPaymentService, DEPOSIT_CHECK_FAILED_MESSAGE } from './deposit-payment.service';
import { assertStatusFitsTime, IN_PROGRESS_TOO_EARLY_MESSAGE } from './appointment-status-time';
import * as solo from './solo';

const logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
const HOUR = 3_600_000;

type Svc = BarbershopService & Record<string, unknown>;
const make = (props: Record<string, unknown>) => {
  const service = Object.create(BarbershopService.prototype) as Svc;
  Object.assign(service, { logger, ...props });
  return service;
};

describe('próximo horário livre de unidade pausada (326)', () => {
  it('não responde para unidade inativa ou fora da página pública', async () => {
    const findFirst = jest.fn(async () => null);
    const service = make({
      publicServices: async () => ({ durationMinutes: 30, services: [] }),
      prisma: { barbershop: { findFirst } },
    });
    expect(await service.getPublicNextAvailableSlot(2, null, [1])).toBeNull();
    const [args] = findFirst.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(args.where.isActive).toBe(true);
  });
});

describe('reserva do sinal mexida pela equipe (327) e sinal recebido à mão (328)', () => {
  const start = new Date(Date.now() + 3 * 86_400_000);
  const end = new Date(start.getTime() + HOUR);

  function updating(settled: 'paid' | 'released') {
    const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 5,
      status: data.status ?? 'CONFIRMED',
      startAt: start,
      endAt: end,
      customer: { name: 'Ana', email: 'ana@x.com' },
      contactEmail: null,
      services: [],
      barber: { name: 'Leo' },
    }));
    const settle = jest.fn(async () => settled);
    const sendAppointmentEmail = jest.fn(async () => undefined);
    const service = make({
      ensureBarbershopAccess: async () => ({ networkId: 1, accessLevel: 'owner', timezone: null }),
      ownBarberIdIfBarber: async () => null,
      ensureOwnAppointment: () => undefined,
      lockSchedule: async () => undefined,
      ensureBarberAvailable: async () => undefined,
      recordNoShowFee: async () => null,
      contactVisibility: async () => () => true,
      hideAppointmentContact: (_can: unknown, row: unknown) => row,
      sendAppointmentEmail,
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
            status: 'PENDING_PAYMENT',
            depositPaid: false,
            depositPaidAt: null,
            prepaidAt: null,
            source: 'ONLINE',
          }),
          findUnique: async () => ({
            status: 'CONFIRMED',
            depositPaid: true,
            depositPaidAt: new Date(),
          }),
        },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({ appointment: { update } }),
      },
    });
    service.registerDepositHolds({ settle, release: jest.fn() });
    return { service, update, settle, sendAppointmentEmail };
  }

  it('confirmar à mão cancela o pagamento aberto, tira o prazo e manda a confirmação', async () => {
    const { service, update, settle, sendAppointmentEmail } = updating('released');
    await service.updateAppointment(1, 2, 5, { status: 'CONFIRMED' });
    expect(settle).toHaveBeenCalledWith(5);
    const [args] = update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(args.data.holdExpiresAt).toBeNull();
    expect(sendAppointmentEmail).toHaveBeenCalledWith(5, 'appointment_confirmation', 'ana@x.com');
  });

  it('pago no meio do caminho: vale o pagamento, sem a confirmação da equipe', async () => {
    const { service, sendAppointmentEmail } = updating('paid');
    await service.updateAppointment(1, 2, 5, { status: 'CONFIRMED' });
    expect(sendAppointmentEmail).not.toHaveBeenCalledWith(
      5,
      'appointment_confirmation',
      expect.anything(),
    );
  });

  function deleting(
    appointment: Record<string, unknown>,
    settled: 'paid' | 'released' = 'released',
  ) {
    const settle = jest.fn(async () => settled);
    const service = make({
      ensureBarbershopAccess: async () => ({ accessLevel: 'owner' }),
      prisma: {
        appointment: {
          findFirst: async () => ({
            id: 5,
            status: 'CONFIRMED',
            startAt: start,
            depositPaid: false,
            depositPaidAt: null,
            sale: null,
            professionalReview: null,
            customerRatings: [],
            tips: [],
            noShowFee: null,
            prepaidAt: null,
            chatThreads: [],
            ...appointment,
          }),
        },
      },
    });
    service.registerDepositHolds({ settle, release: jest.fn() });
    return { service, settle };
  }

  it('excluir reserva paga no meio do caminho é recusado', async () => {
    const { service, settle } = deleting({ status: 'PENDING_PAYMENT' }, 'paid');
    await expect(service.deleteAppointment(1, 2, 5)).rejects.toThrow('sinal pago online');
    expect(settle).toHaveBeenCalledWith(5);
  });

  it('excluir horário com sinal recebido à mão é recusado (328)', async () => {
    const { service } = deleting({ depositPaid: true, depositManualMethod: 'CASH' });
    await expect(service.deleteAppointment(1, 2, 5)).rejects.toThrow(
      DEPOSIT_RECEIVED_DELETE_MESSAGE,
    );
  });

  function deposits(stripe: Record<string, unknown>, appointment: unknown) {
    const deposit = Object.create(DepositPaymentService.prototype) as DepositPaymentService;
    Object.assign(deposit, {
      logger,
      stripe,
      prisma: {
        appointment: {
          findUnique: async () => appointment,
          findFirst: async () => appointment,
          updateMany: async () => ({ count: 0 }),
        },
      },
    });
    return deposit;
  }

  it('pagamento aberto é cancelado antes de a equipe mexer; Stripe fora recusa', async () => {
    const cancelPaymentIntent = jest.fn(async () => undefined);
    const ok = deposits(
      {
        retrievePaymentIntent: async () => ({ id: 'pi_1', status: 'requires_payment_method' }),
        cancelPaymentIntent,
      },
      { status: 'PENDING_PAYMENT', depositPaymentIntentId: 'pi_1' },
    );
    expect(await ok.settleForStaff(5)).toBe('released');
    expect(cancelPaymentIntent).toHaveBeenCalledWith('pi_1');

    const down = deposits(
      {
        retrievePaymentIntent: async () => {
          throw new Error('Stripe fora');
        },
      },
      { status: 'PENDING_PAYMENT', depositPaymentIntentId: 'pi_1' },
    );
    await expect(down.settleForStaff(5)).rejects.toThrow(DEPOSIT_CHECK_FAILED_MESSAGE);
  });

  it('sinal pago para horário confirmado à mão, ou excluído, é estornado', async () => {
    const intent = { id: 'pi_2', status: 'succeeded', metadata: { appointmentId: '5' } };
    for (const appointment of [
      { id: 5, status: 'CONFIRMED', depositPaid: false, depositPaymentIntentId: 'pi_1' },
      null,
    ]) {
      const createRefund = jest.fn(async () => undefined);
      const deposit = deposits({ createRefund }, appointment);
      expect(await deposit.finalize(intent as never)).not.toBe('CONFIRMED');
      expect(createRefund).toHaveBeenCalledWith(
        'pi_2',
        undefined,
        'requested_by_customer',
        'deposit-refund-pi_2',
        false,
      );
    }
  });

  it('sinal já aplicado (tela e webhook juntos) não é estornado', async () => {
    const createRefund = jest.fn(async () => undefined);
    const deposit = deposits(
      { createRefund },
      { id: 5, status: 'CONFIRMED', depositPaid: true, depositPaymentIntentId: 'pi_3' },
    );
    await deposit.finalize({ id: 'pi_3', status: 'succeeded', metadata: {} } as never);
    expect(createRefund).not.toHaveBeenCalled();
  });
});

describe('folga por cima de reserva do sinal (329)', () => {
  it('solta as reservas da pessoa dentro da folga', async () => {
    const release = jest.fn(async () => true);
    const findMany = jest.fn(async () => [{ id: 9, barbershopId: 2 }]);
    const service = make({
      ensureCanManageBarber: async () => undefined,
      samePersonBarberIds: async () => [4, 8],
      realtime: { notify: jest.fn() },
      prisma: {
        barber: { findUnique: async () => ({ id: 4, barbershopId: 2, userId: 7 }) },
        barberTimeOff: { create: async () => ({ id: 1 }) },
        appointment: { findMany, count: async () => 0 },
      },
    });
    service.registerDepositHolds({ settle: jest.fn(), release });
    const start = new Date(Date.now() + 86_400_000);
    const result = await service.createBarberTimeOff(1, {
      barberId: 4,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 8 * HOUR).toISOString(),
    });
    const [args] = findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(args.where.barberId).toEqual({ in: [4, 8] });
    expect(args.where.status).toBe('PENDING_PAYMENT');
    expect(release).toHaveBeenCalledWith(9);
    expect(result.affectedAppointments).toBe(0);
  });
});

describe('remarcar segue as regras de quem marca (330)', () => {
  it('pelo link: unidade pausada não remarca', async () => {
    const service = make({
      loadManagedAppointment: async () => ({
        appt: { id: 5, barbershopId: 2, barbershop: { networkId: 1 } },
        canChange: true,
        readOnly: false,
      }),
      ensureNotBlocked: async () => undefined,
      ensureNotPlatformSuspended: async () => undefined,
      prisma: { barbershop: { findFirst: async () => null } },
    });
    await expect(
      service.rescheduleManagedAppointment('t', new Date().toISOString()),
    ).rejects.toThrow('não está aceitando agendamentos online');
  });

  it('o próprio horário não conta como cruzamento nem no limite', async () => {
    const wheres: Array<Record<string, unknown>> = [];
    const client = {
      customer: { findMany: async () => [] },
      appointment: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          wheres.push(where);
          return null;
        },
        count: async ({ where }: { where: Record<string, unknown> }) => {
          wheres.push(where);
          return 0;
        },
      },
    };
    const service = make({ customerIdsByPhone: async () => [1] });
    const assertCanBook = (
      service as unknown as {
        assertPublicCustomerCanBook: (...args: unknown[]) => Promise<void>;
      }
    ).assertPublicCustomerCanBook.bind(service);
    await assertCanBook(client, 1, '11999990000', null, new Date(), new Date(), 5);
    expect(wheres.map((w) => w.id)).toEqual([{ not: 5 }, { not: 5 }]);
  });

  it('pela agenda: outro mês confere a cota do solo; o mesmo mês não', async () => {
    const spy = jest
      .spyOn(solo, 'assertSoloBookingAllowed')
      .mockRejectedValue(new BadRequestException('cota'));
    const start = new Date('2030-01-30T15:00:00Z');
    const service = make({
      ensureBarbershopAccess: async () => ({ networkId: 1, accessLevel: 'owner', timezone: 'UTC' }),
      ownBarberIdIfBarber: async () => null,
      ensureOwnAppointment: () => undefined,
      prisma: {
        appointment: {
          findFirst: async () => ({
            id: 5,
            customerId: 1,
            barberId: 3,
            startAt: start,
            endAt: new Date(start.getTime() + HOUR),
            status: 'CONFIRMED',
            source: 'PHONE',
          }),
        },
      },
    });
    await expect(
      service.updateAppointment(1, 2, 5, { startAt: new Date('2030-02-02T15:00:00Z') }),
    ).rejects.toThrow('cota');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(sameShopMonth(start, new Date('2030-01-31T23:00:00Z'), 'UTC')).toBe(true);
    // 31/01 23h em São Paulo já é fevereiro em UTC
    expect(sameShopMonth(start, new Date('2030-02-01T01:00:00Z'), 'America/Sao_Paulo')).toBe(true);
  });
});

describe('aviso da lista de espera (331)', () => {
  it('a mesma entrada avisada de duas vagas no mesmo dia gera dois envios', async () => {
    const email = jest.fn(async () => undefined);
    const service = make({
      notificationQueue: { email },
      whatsappService: { isConfigured: () => false },
    });
    const send = (
      service as unknown as { sendWaitlistNotice: (...args: unknown[]) => Promise<void> }
    ).sendWaitlistNotice.bind(service);
    const match = {
      id: 7,
      source: 'online',
      contactEmail: 'ana@x.com',
      customer: { name: 'Ana', email: null, phone: '' },
      barbershop: { country: 'BR', timezone: 'America/Sao_Paulo', name: 'Loja', slug: 'loja' },
    };
    await send(match, new Date('2030-01-30T13:00:00Z'), '2030-01-30');
    await send(match, new Date('2030-01-30T15:00:00Z'), '2030-01-30');
    const ids = email.mock.calls.map((call) => (call as unknown as [unknown, string])[1]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('horários para remarcar pelo link (332)', () => {
  it('desconta o próprio horário, usa a duração dele e tira o horário atual', async () => {
    const startAt = new Date(Date.now() + 2 * 86_400_000);
    startAt.setUTCMinutes(0, 0, 0);
    const other = new Date(startAt.getTime() + 30 * 60_000).toISOString();
    const slotsForBarber = jest.fn(async () => [startAt.toISOString(), other]);
    const service = make({
      loadManagedAppointment: async () => ({
        appt: {
          id: 5,
          barbershopId: 2,
          barberId: 3,
          startAt,
          endAt: new Date(startAt.getTime() + 75 * 60_000),
        },
        canChange: true,
      }),
      slotsForBarber,
      prisma: {
        barbershop: { findFirst: async () => ({ timezone: 'UTC', minBookingLeadMinutes: 0 }) },
        barber: { findFirst: async () => ({ id: 3 }) },
      },
    });
    const day = startAt.toISOString().slice(0, 10);
    expect(await service.getManagedAppointmentSlots('t', day)).toEqual([other]);
    const args = slotsForBarber.mock.calls[0] as unknown as unknown[];
    expect(args[2]).toBe(75);
    expect(args[6]).toBe(5);
  });

  it('link que não muda mais não lista horários', async () => {
    const service = make({
      loadManagedAppointment: async () => ({ appt: {}, canChange: false }),
    });
    expect(await service.getManagedAppointmentSlots('t', '2030-01-01')).toEqual([]);
  });
});

describe('período do profissional (333)', () => {
  function service(stranded: number) {
    const update = jest.fn(async () => ({}));
    const shop = make({
      ensureBarbershopAccess: async () => ({ accessLevel: 'owner', ownerUserId: 1, id: 2 }),
      prisma: {
        barber: {
          findFirst: async () => ({
            id: 4,
            userId: 7,
            staffType: 'barber',
            isActive: true,
            takesAppointments: null,
            accessStartsAt: null,
            accessEndsAt: null,
          }),
          update,
        },
        appointment: { count: async () => stranded },
      },
    });
    return { shop, update };
  }

  it('fim do período antes de horário marcado é recusado', async () => {
    const { shop, update } = service(1);
    await expect(
      shop.updateBarber(1, 2, 4, { accessEndsAt: '2030-01-15T00:00:00Z' }),
    ).rejects.toThrow(engagementStrandedMessage(1));
    expect(update).not.toHaveBeenCalled();
  });

  it('período sem horário fora dele é salvo; período igual nem confere', async () => {
    const free = service(0);
    await free.shop.updateBarber(1, 2, 4, { accessEndsAt: '2030-01-15T00:00:00Z' });
    expect(free.update).toHaveBeenCalled();
    const same = service(3);
    await same.shop.updateBarber(1, 2, 4, { accessEndsAt: null, name: 'Leo' });
    expect(same.update).toHaveBeenCalled();
  });
});

describe('cliente bloqueado e a lista de espera (334)', () => {
  it('ao bloquear, sai da lista de espera da rede', async () => {
    const dropWaitlistEntry = jest.fn(async () => undefined);
    const entry = { id: 3, status: 'NOTIFIED' };
    const service = make({
      ensureBarbershopAccess: async () => ({ networkId: 1, accessLevel: 'owner' }),
      clientAccountIdForCustomer: async () => 8,
      customerIdsByPhone: async () => [1, 2],
      contactVisibility: async () => () => true,
      hideContact: (_can: unknown, row: unknown) => row,
      dropWaitlistEntry,
      prisma: {
        customer: {
          findFirst: async () => ({ id: 1, phone: '11999990000', blockedAt: null }),
          update: async () => ({ id: 1 }),
        },
        waitlistEntry: { findMany: async () => [entry] },
      },
    });
    await service.setCustomerBlocked(1, 2, 1, true, 'faltou');
    expect(dropWaitlistEntry).toHaveBeenCalledWith(entry);
  });

  it('bloqueado ou suspenso não é avisado', async () => {
    const entry = {
      contactEmail: null,
      customer: { phone: '11999990000', email: null, clientAccountId: null },
      barbershop: { networkId: 1 },
    };
    const check = (props: Record<string, unknown>) =>
      (
        make(props) as unknown as { waitlistCustomerCanBook: (e: unknown) => Promise<boolean> }
      ).waitlistCustomerCanBook(entry);
    const ok = async () => undefined;
    const refuse = async () => {
      throw new BadRequestException('bloqueado');
    };
    expect(await check({ ensureNotBlocked: ok, ensureNotPlatformSuspended: ok })).toBe(true);
    expect(await check({ ensureNotBlocked: refuse, ensureNotPlatformSuspended: ok })).toBe(false);
    expect(await check({ ensureNotBlocked: ok, ensureNotPlatformSuspended: refuse })).toBe(false);
  });
});

describe('em atendimento só perto do início (335)', () => {
  it('amanhã é recusado; daqui a 10 minutos vale', () => {
    const now = new Date('2030-01-30T12:00:00Z');
    expect(() =>
      assertStatusFitsTime('IN_PROGRESS', new Date(now.getTime() + 24 * HOUR), now),
    ).toThrow(IN_PROGRESS_TOO_EARLY_MESSAGE);
    expect(() =>
      assertStatusFitsTime('IN_PROGRESS', new Date(now.getTime() + 10 * 60_000), now),
    ).not.toThrow();
  });
});

describe('avisos ao vivo (336)', () => {
  it('mudar expediente, escala ou fechamento avisa a agenda e a página', async () => {
    const notify = jest.fn();
    const service = make({
      realtime: { notify },
      waitlistOpeningSnapshot: async () => new Map(),
      checkWaitlistOnOpening: async () => 0,
    });
    await service.withWaitlistOpening(2, {}, async () => true);
    expect(notify).toHaveBeenCalledWith(2, 'APPOINTMENT', 'UPDATED');
  });

  it('reserva vencida avisa ao ser solta', async () => {
    const notify = jest.fn();
    const deposit = Object.create(DepositPaymentService.prototype) as DepositPaymentService;
    Object.assign(deposit, {
      logger,
      realtime: { notify },
      barbershopService: { checkWaitlistOnCancellation: async () => undefined },
      prisma: {
        appointment: {
          findUnique: async () => ({
            id: 5,
            status: 'PENDING_PAYMENT',
            barbershopId: 2,
            depositPaymentIntentId: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
      },
    });
    expect(await deposit.releaseUnpaidHold(5)).toBe(true);
    expect(notify).toHaveBeenCalledWith(2, 'APPOINTMENT', 'UPDATED');
  });
});
