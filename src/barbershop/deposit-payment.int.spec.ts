/**
 * Sinal pago online, contra o Postgres de verdade e com o Stripe simulado:
 * horário reservado aguardando o pagamento, confirmado uma vez só (tela ou
 * webhook), liberado sem pagamento, estornado quando precisa e o repasse.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { DepositPaymentService } from './deposit-payment.service';
import { createAppointmentToken } from './appointment-link';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

function mondayAhead(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7);
  return d.toISOString().slice(0, 10);
}
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`);
const settle = () => new Promise((r) => setTimeout(r, 50));

type Intent = {
  id: string;
  client_secret: string;
  status: string;
  metadata: Record<string, string>;
};

describe('Sinal online (integração, Stripe simulado)', () => {
  const prisma = new PrismaService();
  const emails: any[] = [];
  const intents = new Map<string, Intent>();
  const refunds: string[] = [];
  let seq = 0;
  const stripe = {
    createPaymentIntent: async (amount: number, currency: string, _c: unknown, opts: any) => {
      const pi: Intent = {
        id: `pi_${RUN}_${++seq}`,
        client_secret: `secret_${seq}`,
        status: 'requires_payment_method',
        metadata: { ...opts.metadata, amount: String(amount), currency },
      };
      intents.set(pi.id, pi);
      return pi;
    },
    retrievePaymentIntent: async (id: string) => intents.get(id)!,
    cancelPaymentIntent: async (id: string) => {
      intents.get(id)!.status = 'canceled';
    },
    createRefund: async (id: string) => {
      if (failNextRefund) {
        failNextRefund = false;
        throw new Error('Stripe fora do ar');
      }
      refunds.push(id);
    },
  };
  let failNextRefund = false;
  const stub = {} as never;
  const barbershops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stripe as never,
    { email: async (job: any) => void emails.push(job), whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const deposits = new DepositPaymentService(prisma, stripe as never, barbershops, {
    email: async (job: any) => void emails.push(job),
  } as never);
  const monday = mondayAhead();
  const pay = (id: string) => (intents.get(id)!.status = 'succeeded');

  let ownerId: number;
  let staffUserId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let serviceId: number;
  let n = 0;

  const createUser = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `dep-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Teste ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
  const book = (hhmm: string) =>
    barbershops.createPublicAppointment({
      barbershopId: shopId,
      barberId,
      serviceIds: [serviceId],
      startAt: at(monday, hhmm).toISOString(),
      customerName: 'Cliente Sinal',
      customerPhone: `4${RUN.slice(-9)}${++n}`,
      customerEmail: `sinal-${n}-${RUN}@test.local`,
    });

  const stripeKeyBefore = process.env.STRIPE_SECRET_KEY;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_simulado';
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner', roleId);
    staffUserId = await createUser('staff', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Dep ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Sinal',
          slug: `dep-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `dep-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Ana', phone: '11911111111', userId: staffUserId },
      })
    ).id;
    serviceId = (
      await prisma.barbershopService.create({
        data: {
          barbershopId: shopId,
          name: 'Corte',
          durationMinutes: 30,
          price: new Decimal(80),
          depositAmount: new Decimal(20),
        },
      })
    ).id;
  });

  afterEach(async () => {
    await settle();
    emails.length = 0;
  });

  afterAll(async () => {
    if (stripeKeyBefore === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = stripeKeyBefore;
    await prisma.waitlistEntry.deleteMany({ where: { barbershopId: shopId } });
    await prisma.saleItem.deleteMany({ where: { sale: { barbershopId: shopId } } });
    await prisma.sale.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointmentService.deleteMany({
      where: { appointment: { barbershopId: shopId } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('desligado, agenda confirmado como antes; ligar exige Stripe configurado e gerente/dono', async () => {
    const plain = await book('09:00');
    expect(plain!.status).toBe('CONFIRMED');

    await expect(deposits.setOnlineDeposit(staffUserId, shopId, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    process.env.STRIPE_SECRET_KEY = 'sk_test_sua_chave_aqui';
    await expect(deposits.setOnlineDeposit(ownerId, shopId, true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    process.env.STRIPE_SECRET_KEY = 'sk_test_simulado';
    await expect(deposits.setOnlineDeposit(ownerId, shopId, true)).resolves.toBe(true);
  });

  it('ligado: reserva aguardando o sinal; paga uma vez, confirma e avisa uma vez só', async () => {
    const appt = await book('10:00');
    expect(appt!.status).toBe('PENDING_PAYMENT');
    expect(appt!.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    await settle();
    expect(emails).toHaveLength(0); // confirmação só depois de pagar

    // O horário fica reservado
    await expect(book('10:00')).rejects.toBeInstanceOf(BadRequestException);

    const token = createAppointmentToken(appt!.id);
    const first = await deposits.start(token);
    const again = await deposits.start(token);
    expect(first).toMatchObject({ clientSecret: 'secret_1', amount: 20, currency: 'BRL' });
    expect(again.clientSecret).toBe(first.clientSecret); // um pagamento só
    expect(intents.get(`pi_${RUN}_1`)!.metadata).toMatchObject({
      kind: 'appointment_deposit',
      appointmentId: String(appt!.id),
      amount: '2000',
    });

    // Ainda não pagou
    expect(await deposits.confirm(token)).toBe('PENDING_PAYMENT');
    pay(`pi_${RUN}_1`);
    expect(await deposits.confirm(token)).toBe('CONFIRMED');
    // Webhook chegando depois não confirma de novo
    expect(await deposits.finalize(intents.get(`pi_${RUN}_1`) as never)).toBe('CONFIRMED');
    await settle();
    expect(emails.filter((e) => e.template === 'appointment_confirmation')).toHaveLength(1);

    const saved = await prisma.appointment.findUniqueOrThrow({ where: { id: appt!.id } });
    expect(saved).toMatchObject({ status: 'CONFIRMED', depositPaid: true, holdExpiresAt: null });
    await expect(deposits.start(token)).rejects.toThrow('O sinal já foi pago');
  });

  it('sem pagar a tempo, o horário é liberado; se pagou no último minuto, confirma', async () => {
    const unpaid = await book('11:00');
    const lastMinute = await book('12:00');
    await deposits.start(createAppointmentToken(unpaid!.id));
    const { clientSecret } = await deposits.start(createAppointmentToken(lastMinute!.id));
    const lastId = [...intents.values()].find((i) => i.client_secret === clientSecret)!.id;
    pay(lastId);
    await prisma.appointment.updateMany({
      where: { id: { in: [unpaid!.id, lastMinute!.id] } },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });

    await deposits.expireHolds();
    const [a, b] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: unpaid!.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: lastMinute!.id } }),
    ]);
    expect(a.status).toBe('CANCELLED');
    expect(intents.get(a.depositPaymentIntentId!)!.status).toBe('canceled');
    expect(b.status).toBe('CONFIRMED');
    // O horário liberado volta a ser oferecido
    await expect(book('11:00')).resolves.toBeTruthy();
    // Tempo acabou: não dá mais pra pagar
    await expect(deposits.start(createAppointmentToken(unpaid!.id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('pagou depois de liberado: estorna; cancelou pelo link no prazo: estorna', async () => {
    const late = await book('14:00');
    await deposits.start(createAppointmentToken(late!.id));
    const lateAppt = await prisma.appointment.findUniqueOrThrow({ where: { id: late!.id } });
    await prisma.appointment.update({ where: { id: late!.id }, data: { status: 'CANCELLED' } });
    pay(lateAppt.depositPaymentIntentId!);
    expect(await deposits.finalize(intents.get(lateAppt.depositPaymentIntentId!) as never)).toBe(
      'REFUNDED',
    );
    expect(refunds).toContain(lateAppt.depositPaymentIntentId);

    const paid = await book('15:00');
    const token = createAppointmentToken(paid!.id);
    await deposits.start(token);
    const piId = (await prisma.appointment.findUniqueOrThrow({ where: { id: paid!.id } }))
      .depositPaymentIntentId!;
    pay(piId);
    await deposits.confirm(token);
    await barbershops.cancelManagedAppointment(token);
    expect(await deposits.refundOnClientCancel(paid!.id)).toBe(true);
    expect(refunds).toContain(piId);
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: paid!.id } })).depositPaid,
    ).toBe(false);
  });

  it('repasse: só o sinal pago pelo Stripe e não estornado, com a taxa da plataforma', async () => {
    // Pagos: 10:00 e 12:00 (os estornados não contam)
    const report = await deposits.payoutReport(ownerId, shopId);
    expect(report).toMatchObject({
      paymentsCount: 2,
      grossAmount: 40,
      platformFeePercentage: 15,
      platformFeeAmount: 6,
      netOwedToBarbershop: 34,
    });
    await expect(deposits.payoutReport(staffUserId, shopId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  // Agendado pela página e com o sinal pago (confirmado)
  const paidBooking = async (hhmm: string) => {
    const appt = await book(hhmm);
    const token = createAppointmentToken(appt!.id);
    await deposits.start(token);
    const piId = (await prisma.appointment.findUniqueOrThrow({ where: { id: appt!.id } }))
      .depositPaymentIntentId!;
    pay(piId);
    expect(await deposits.confirm(token)).toBe('CONFIRMED');
    return { id: appt!.id, piId };
  };
  const load = (id: number) => prisma.appointment.findUniqueOrThrow({ where: { id } });

  it('a unidade cancela: estorna sozinho (ou retém, se escolher); falta retém', async () => {
    const a = await paidBooking('16:00');
    await barbershops.updateAppointment(ownerId, shopId, a.id, { status: 'CANCELLED' });
    expect(refunds).toContain(a.piId);
    expect(await load(a.id)).toMatchObject({ depositPaid: false });
    expect((await load(a.id)).depositRefundedAt).toBeInstanceOf(Date);
    await expect(barbershops.refundAppointmentDeposit(ownerId, shopId, a.id)).rejects.toThrow(
      'O sinal já foi estornado',
    );

    const kept = await paidBooking('16:30');
    await barbershops.updateAppointment(
      ownerId,
      shopId,
      kept.id,
      { status: 'CANCELLED' },
      { refundDeposit: false },
    );
    expect(refunds).not.toContain(kept.piId);
    expect(await load(kept.id)).toMatchObject({ depositPaid: true, depositRefundedAt: null });

    const noShow = await paidBooking('17:00');
    await barbershops.updateAppointment(ownerId, shopId, noShow.id, { status: 'NO_SHOW' });
    expect(refunds).not.toContain(noShow.piId);
  });

  it('estorno manual: gerente/dono, uma vez só; falha do Stripe desfaz a marca', async () => {
    const a = await paidBooking('17:30');
    // Sinal online não se desmarca na mão nem some com o horário
    await expect(
      barbershops.setAppointmentDepositPaid(ownerId, shopId, a.id, false),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(barbershops.deleteAppointment(ownerId, shopId, a.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      barbershops.refundAppointmentDeposit(staffUserId, shopId, a.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    failNextRefund = true;
    await expect(barbershops.refundAppointmentDeposit(ownerId, shopId, a.id)).rejects.toThrow(
      'Não foi possível estornar agora',
    );
    expect(await load(a.id)).toMatchObject({ depositPaid: true, depositRefundedAt: null });

    const [r1, r2] = await Promise.allSettled([
      barbershops.refundAppointmentDeposit(ownerId, shopId, a.id),
      barbershops.refundAppointmentDeposit(ownerId, shopId, a.id),
    ]);
    expect([r1.status, r2.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(refunds.filter((id) => id === a.piId)).toHaveLength(1);
    const saved = await load(a.id);
    expect(saved).toMatchObject({ status: 'CONFIRMED', depositPaid: false });
  });

  it('reserva sem sinal que expirou avisa a lista de espera; horário passado não', async () => {
    const customerId = (
      await prisma.customer.create({
        data: {
          networkId,
          name: 'Na Espera',
          phone: '11900000000',
          email: `espera-${RUN}@test.local`,
        },
      })
    ).id;
    const entry = await prisma.waitlistEntry.create({
      data: { barbershopId: shopId, customerId, date: new Date(`${monday}T00:00:00Z`) },
    });
    const held = await book('13:00');
    await prisma.appointment.update({
      where: { id: held!.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    await deposits.expireHolds();
    await settle();
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe(
      'NOTIFIED',
    );
    expect(emails.map((e) => e.template)).toContain('waitlist_slot_available');

    // Horário que já passou não é vaga pra ninguém
    await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'WAITING' } });
    await barbershops.checkWaitlistOnCancellation(shopId, {
      startAt: new Date(Date.now() - 3600_000),
      barberId,
      services: [],
    });
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe(
      'WAITING',
    );
  });

  it('lembrete do sinal: depois de alguns minutos sem pagar, uma vez só, com o link', async () => {
    const appt = await book('13:30');
    // Acabou de reservar: ainda não lembra
    expect(await deposits.remindPendingHolds()).toBe(0);
    const later = new Date(Date.now() + 6 * 60_000);
    expect(await deposits.remindPendingHolds(later)).toBeGreaterThanOrEqual(1);
    await settle();
    const to = (
      await prisma.appointment.findUniqueOrThrow({
        where: { id: appt!.id },
        include: { customer: true },
      })
    ).customer.email;
    const reminder = emails.find((e) => e.template === 'deposit_pending' && e.to === to);
    expect(reminder).toBeTruthy();
    expect(reminder.context.PayURL).toContain('/booking/manage?t=');
    expect(reminder.context.DepositAmount).toContain('20');
    // Não repete
    expect(await deposits.remindPendingHolds(later)).toBe(0);
    // Perto de expirar não adianta lembrar
    const late = await book('14:30');
    expect(await deposits.remindPendingHolds(new Date(Date.now() + 14 * 60_000))).toBe(0);
    expect((await load(late!.id)).holdReminderSentAt).toBeNull();
    expect((await load(appt!.id)).holdReminderSentAt).toBeInstanceOf(Date);
  });

  it('fechar a conta do horário: sinal descontado, conclui, uma venda só', async () => {
    const a = await paidBooking('11:30');
    const sale = (payload: object = {}) =>
      barbershops.createSale(ownerId, shopId, {
        appointmentId: a.id,
        barberId,
        saleType: 'SERVICE',
        items: [{ itemType: 'SERVICE', serviceId, quantity: 1, unitPrice: 80, totalPrice: 80 }],
        subtotal: 80,
        total: 80,
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        ...payload,
      });
    const created = await sale();
    expect(Number(created!.total)).toBe(60);
    expect(Number(created!.depositApplied)).toBe(20);
    expect((await load(a.id)).status).toBe('COMPLETED');
    await expect(sale()).rejects.toThrow('já foi cobrado');
    const [listed] = (await barbershops.getAppointments(ownerId, shopId, {})).filter(
      (x) => x.id === a.id,
    );
    expect(listed).toMatchObject({ saleId: created!.id });

    // Horário cancelado não se cobra
    const cancelled = await paidBooking('12:30');
    await barbershops.updateAppointment(ownerId, shopId, cancelled.id, { status: 'CANCELLED' });
    await expect(
      barbershops.createSale(ownerId, shopId, {
        appointmentId: cancelled.id,
        saleType: 'SERVICE',
        items: [],
        subtotal: 0,
        total: 0,
      }),
    ).rejects.toThrow('não pode ser cobrado');
  });

  it('folga: valida o período, conta os horários marcados e aparece na agenda da unidade', async () => {
    const monday9 = at(monday, '09:00');
    await expect(
      barbershops.createBarberTimeOff(ownerId, {
        barberId,
        startAt: monday9.toISOString(),
        endAt: monday9.toISOString(),
      }),
    ).rejects.toThrow('Período inválido');
    await expect(
      barbershops.createBarberTimeOff(ownerId, {
        barberId,
        startAt: monday9.toISOString(),
        endAt: at(monday, '10:00').toISOString(),
        reason: 'FERIAS',
      }),
    ).rejects.toThrow('Motivo inválido');
    // A própria barbeira marca a folga dela; o horário das 09:00 continua lá
    const off = await barbershops.createBarberTimeOff(staffUserId, {
      barberId,
      startAt: at(monday, '08:00').toISOString(),
      endAt: at(monday, '09:30').toISOString(),
      reason: 'PERSONAL',
    });
    expect(off.affectedAppointments).toBe(1);
    const list = await barbershops.getBarbershopTimeOffs(
      ownerId,
      shopId,
      at(monday, '00:00'),
      at(monday, '23:59'),
    );
    expect(list).toEqual([expect.objectContaining({ id: off.id, barberName: 'Ana' })]);
    await barbershops.deleteBarberTimeOff(ownerId, off.id);
  });
});
