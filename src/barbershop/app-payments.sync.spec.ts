import { AppPaymentsService } from './app-payments.service';
import type Stripe from 'stripe';

function charge(partial: Partial<Stripe.Charge>): Stripe.Charge {
  return {
    payment_intent: 'pi_1',
    amount_refunded: 1000,
    refunded: true,
    ...partial,
  } as Stripe.Charge;
}

describe('AppPaymentsService.syncStripeRefund', () => {
  function setup() {
    const appointment = {
      findFirst: jest.fn(async ({ where }: { where: Record<string, string> }) => {
        if (where.depositPaymentIntentId) return appointment.deposit;
        if (where.prepaidPaymentIntentId) return appointment.prepaid;
        return null;
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
      deposit: null as null | { id: number; depositAmount: number; depositRefundedAt: Date | null },
      prepaid: null as null | {
        id: number;
        prepaidAt: Date;
        prepaidAmount: number;
        prepaidRefundedAt: Date | null;
        prepaidRefundedAmount: number | null;
      },
    };
    const appointmentTip = {
      findFirst: jest.fn(async () => appointmentTip.row),
      updateMany: jest.fn(async () => ({ count: 1 })),
      row: null as null | { id: number; amount: number; refundedAt: Date | null },
    };
    const service = new AppPaymentsService(
      { appointment, appointmentTip } as never,
      {} as never,
      {} as never,
    );
    return { service, appointment, appointmentTip };
  }

  it('marca o sinal estornado no painel', async () => {
    const { service, appointment } = setup();
    appointment.deposit = { id: 4, depositAmount: 10, depositRefundedAt: null };
    await service.syncStripeRefund(charge({}));
    expect(appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 4, depositRefundedAt: null },
        data: expect.objectContaining({ depositPaid: false }),
      }),
    );
  });

  it('não mexe num sinal que já estava estornado', async () => {
    const { service, appointment } = setup();
    appointment.deposit = { id: 4, depositAmount: 10, depositRefundedAt: new Date() };
    await service.syncStripeRefund(charge({}));
    expect(appointment.updateMany).not.toHaveBeenCalled();
  });

  it('estorno parcial do atendimento pago guarda o valor e não fecha', async () => {
    const { service, appointment } = setup();
    appointment.prepaid = {
      id: 8,
      prepaidAt: new Date(),
      prepaidAmount: 40,
      prepaidRefundedAt: null,
      prepaidRefundedAmount: 0,
    };
    await service.syncStripeRefund(charge({ amount_refunded: 1500, refunded: false }));
    expect(appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { prepaidRefundedAmount: 15, prepaidRefundedAt: null },
      }),
    );
  });

  it('não reduz um estorno que o app já tinha registrado', async () => {
    const { service, appointment } = setup();
    appointment.prepaid = {
      id: 8,
      prepaidAt: new Date(),
      prepaidAmount: 40,
      prepaidRefundedAt: null,
      prepaidRefundedAmount: 20,
    };
    await service.syncStripeRefund(charge({ amount_refunded: 500, refunded: false }));
    expect(appointment.updateMany).not.toHaveBeenCalled();
  });

  it('marca a caixinha estornada', async () => {
    const { service, appointmentTip } = setup();
    appointmentTip.row = { id: 3, amount: 10, refundedAt: null };
    await service.syncStripeRefund(charge({ amount_refunded: 1000, refunded: true }));
    expect(appointmentTip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 3, refundedAt: null },
        data: expect.objectContaining({ refundedAt: expect.any(Date) }),
      }),
    );
  });

  it('ignora cobrança que não é sinal, atendimento ou caixinha', async () => {
    const { service, appointment, appointmentTip } = setup();
    await service.syncStripeRefund(charge({ payment_intent: 'pi_outro', amount_refunded: 500 }));
    expect(appointment.updateMany).not.toHaveBeenCalled();
    expect(appointmentTip.updateMany).not.toHaveBeenCalled();
  });
});
