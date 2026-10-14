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
    // Destaque e taxa da vaga: nada com esse pagamento
    const featuredPurchase = { findUnique: jest.fn(async () => null) };
    const jobApplication = { updateMany: jest.fn(async () => ({ count: 0 })) };
    const clientSubscriptionPayment = { updateMany: jest.fn(async () => ({ count: 0 })) };
    const service = new AppPaymentsService(
      {
        appointment,
        appointmentTip,
        featuredPurchase,
        jobApplication,
        clientSubscriptionPayment,
      } as never,
      {} as never,
      {} as never,
    );
    return { service, appointment, appointmentTip, jobApplication, clientSubscriptionPayment };
  }

  it('fatura do clube estornada guarda o total devolvido (só sobe)', async () => {
    const { service, clientSubscriptionPayment } = setup();
    await service.syncStripeRefund(
      charge({ invoice: 'in_1', amount_refunded: 2500, currency: 'brl', refunded: false }),
    );
    expect(clientSubscriptionPayment.updateMany).toHaveBeenCalledWith({
      where: {
        stripeInvoiceId: 'in_1',
        OR: [{ refundedAmount: null }, { refundedAmount: { lt: 25 } }],
      },
      data: { refundedAmount: 25 },
    });
  });

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

  it('taxa da vaga estornada deixa de contar como paga (só no estorno total)', async () => {
    const { service, jobApplication } = setup();
    await service.syncStripeRefund(charge({ refunded: false, amount_refunded: 100 }));
    expect(jobApplication.updateMany).not.toHaveBeenCalled();
    await service.syncStripeRefund(charge({}));
    expect(jobApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { feePaymentIntentId: 'pi_1', feePaidAt: { not: null }, feeRefundedAt: null },
        data: expect.objectContaining({ feePaidAt: null, feePaymentIntentId: null }),
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

  it('em moeda sem centavos, o estorno parcial vale o valor inteiro', async () => {
    const { service, appointment } = setup();
    appointment.prepaid = {
      id: 8,
      prepaidAt: new Date(),
      prepaidAmount: 4000,
      prepaidRefundedAt: null,
      prepaidRefundedAmount: 0,
    };
    // ¥1.500 vêm da Stripe como 1500 (não 150000)
    await service.syncStripeRefund(
      charge({ amount_refunded: 1500, refunded: false, currency: 'jpy' }),
    );
    expect(appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { prepaidRefundedAmount: 1500, prepaidRefundedAt: null },
      }),
    );
  });

  it('em moeda sem centavos, estorno menor que o sinal não marca estornado', async () => {
    const { service, appointment } = setup();
    appointment.deposit = { id: 4, depositAmount: 1000, depositRefundedAt: null };
    await service.syncStripeRefund(
      charge({ amount_refunded: 500, refunded: false, currency: 'jpy' }),
    );
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
