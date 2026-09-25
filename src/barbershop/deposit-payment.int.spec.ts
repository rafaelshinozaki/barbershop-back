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
    createRefund: async (id: string) => void refunds.push(id),
  };
  const stub = {} as never;
  const barbershops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async (job: any) => void emails.push(job), whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const deposits = new DepositPaymentService(prisma, stripe as never, barbershops);
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
});
