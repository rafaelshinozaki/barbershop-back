import { BadRequestException } from '@nestjs/common';
import { BarbershopService, MANAGED_PAID_MESSAGE } from './barbershop.service';
import { createAppointmentToken } from './appointment-link';
import { assertPublicTextLimits, PUBLIC_TEXT_LIMITS } from './public-text-limits';

process.env.JWT_SECRET ??= 'round-337-339';

const DAY = 86_400_000;

describe('horário já cobrado pelo link do cliente (338)', () => {
  const appt = {
    id: 5,
    linkVersion: 0,
    status: 'CONFIRMED',
    createdAt: new Date(Date.now() - 2 * DAY),
    startAt: new Date(Date.now() + 3 * DAY),
    endAt: new Date(Date.now() + 3 * DAY + 3_600_000),
    barbershop: { network: { lateCancellationWindowHours: 24 } },
    sale: { id: 9 } as { id: number } | null,
  };

  function service(row: typeof appt) {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const createRefund = jest.fn();
    const shop = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(shop, {
      stripeService: { createRefund },
      prisma: {
        appointment: {
          findUnique: async () => ({
            ...row,
            depositPaymentIntentId: 'pi_1',
            depositPaidAt: new Date(),
            prepaidPaymentIntentId: 'pi_2',
            prepaidAt: new Date(),
            prepaidRefundedAt: null,
            prepaidAmount: 50,
            barbershop: { ...row.barbershop, currency: 'BRL' },
          }),
          updateMany,
        },
      },
    });
    return { shop, updateMany, createRefund };
  }

  it('não cancela nem remarca, e diz que já foi pago', async () => {
    const { shop, updateMany } = service(appt);
    const token = createAppointmentToken(appt.id, appt.linkVersion);
    await expect(shop.cancelManagedAppointment(token)).rejects.toThrow(MANAGED_PAID_MESSAGE);
    expect(updateMany).not.toHaveBeenCalled();
    await expect(
      shop.rescheduleManagedAppointment(token, new Date().toISOString()),
    ).rejects.toThrow(MANAGED_PAID_MESSAGE);
  });

  it('sem venda o link continua mudando', async () => {
    const { shop, updateMany } = service({ ...appt, sale: null });
    const shopWithWaitlist = shop as unknown as Record<string, unknown>;
    shopWithWaitlist.checkWaitlistOnCancellation = async () => undefined;
    await shop.cancelManagedAppointment(createAppointmentToken(appt.id, appt.linkVersion));
    expect(updateMany).toHaveBeenCalled();
  });

  it('o sinal e o pago pelo app que a venda descontou não voltam', async () => {
    const { shop, updateMany, createRefund } = service(appt);
    expect(await shop.refundOnlineDeposit(appt.id)).toBe(false);
    expect(await shop.refundPrepayment(appt.id)).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(createRefund).not.toHaveBeenCalled();
  });
});

describe('tamanho dos campos da página pública (339)', () => {
  it('recusa nome, telefone e observação longos demais', () => {
    expect(() => assertPublicTextLimits({ name: 'A'.repeat(5000) })).toThrow(BadRequestException);
    expect(() => assertPublicTextLimits({ phone: '1'.repeat(31) })).toThrow('Telefone inválido');
    expect(() =>
      assertPublicTextLimits({ notes: 'x'.repeat(PUBLIC_TEXT_LIMITS.notes + 1) }),
    ).toThrow('Observação muito longa');
    expect(() =>
      assertPublicTextLimits({ name: 'Ana Souza', phone: '11999990000', notes: null }),
    ).not.toThrow();
  });

  it('o agendamento público recusa antes de criar qualquer coisa', async () => {
    const findFirst = jest.fn();
    const shop = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(shop, { prisma: { barbershop: { findFirst } } });
    await expect(
      shop.createPublicAppointment({
        barbershopId: 1,
        serviceIds: [1],
        startAt: new Date().toISOString(),
        customerName: 'A'.repeat(5000),
        customerPhone: '11999990000',
      }),
    ).rejects.toThrow('Nome muito longo');
    expect(findFirst).not.toHaveBeenCalled();
  });
});
