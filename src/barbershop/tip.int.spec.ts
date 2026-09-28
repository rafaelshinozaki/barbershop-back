import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { TipService } from './tip.service';
import { ConnectService } from './connect.service';
import { createReviewToken } from './appointment-link';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

const RUN = `${Date.now()}`.slice(-9);
const HOUR = 3_600_000;

/**
 * Caixinha registrada na mão: destino profissional ou unidade, meio
 * dinheiro/Pix/cartão. Do profissional recebida pela unidade vira lançamento
 * TIP no pagamento dele; depois do fechamento não se apaga.
 */
describe('Caixinha do atendimento (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const barbershops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  // Stripe simulado: pagamento da caixinha pelo app
  const intents = new Map<string, any>();
  let seq = 0;
  const stripe = {
    createPaymentIntent: async (amount: number, currency: string, _c: unknown, opts: any) => {
      const pi = {
        id: `pi_tip_${RUN}_${++seq}`,
        client_secret: `secret_${seq}`,
        status: 'requires_payment_method',
        amount,
        currency,
        metadata: opts.metadata,
        transfer_data: opts.destination ? { destination: opts.destination.accountId } : null,
        application_fee_amount: opts.destination?.applicationFeeAmount ?? null,
      };
      intents.set(pi.id, pi);
      return pi;
    },
    retrievePaymentIntent: async (id: string) => intents.get(id),
  };
  // Sem Stripe configurado: o cadastro da conta é o do fornecedor falso
  const connect = new ConnectService(prisma, stripe as never, barbershops, {
    get: (k: string) => ({ FRONTEND_URL: 'https://app.test', NODE_ENV: 'test' }[k]),
  } as never);
  const tips = new TipService(prisma, barbershops, stripe as never, connect);

  const users: Record<string, number> = {};
  let networkId: number;
  let shopId: number;
  let soloShopId: number;
  let proBarber: number;
  let soloBarber: number;
  let customerId: number;
  let n = 0;

  const user = async (label: string, roleId: number) =>
    (users[label] = (
      await prisma.user.create({
        data: {
          email: `tip-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Pessoa ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+55${++n}${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id);

  const shop = (label: string, practiceKind = 'shop') =>
    prisma.barbershop.create({
      data: {
        name: `Unidade ${label}`,
        slug: `tip-${label}-${RUN}`,
        address: 'Rua A, 1',
        city: 'SP',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `tip-${label}-${RUN}@test.local`,
        networkId,
        ownerUserId: users.dono,
        practiceKind,
      },
    });

  const appointment = (barbershopId: number, barberId: number, status = 'COMPLETED') =>
    prisma.appointment.create({
      data: {
        barbershopId,
        barberId,
        customerId,
        startAt: new Date(Date.now() - 3 * HOUR),
        endAt: new Date(Date.now() - 2 * HOUR),
        status,
      },
    });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    for (const label of ['dono', 'pro', 'outro']) await user(label, roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: users.dono, name: `Rede Tip ${RUN}` } })
    ).id;
    shopId = (await shop('a')).id;
    soloShopId = (await shop('solo', 'solo')).id;
    proBarber = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Pro', phone: '11911111111', userId: users.pro },
      })
    ).id;
    await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Outro', phone: '11922222222', userId: users.outro },
    });
    soloBarber = (
      await prisma.barber.create({
        data: { barbershopId: soloShopId, name: 'Solo', phone: '11933333333', userId: users.dono },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Carla Cliente', phone: `7${RUN}` },
      })
    ).id;
  });

  const stripeKeyBefore = process.env.STRIPE_SECRET_KEY;

  afterAll(async () => {
    if (stripeKeyBefore === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = stripeKeyBefore;
    await prisma.paymentAccount.deleteMany({
      where: {
        stripeAccountId: { startsWith: 'acct_fake_' },
        createdByUserId: { in: Object.values(users) },
      },
    });
    await prisma.professional.deleteMany({ where: { userId: users.pro } });
    await prisma.barberPayEntry.deleteMany({
      where: { barbershopId: { in: [shopId, soloShopId] } },
    });
    await prisma.barberPayout.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: { in: [shopId, soloShopId] } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.delete({ where: { id: networkId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    await prisma.$disconnect();
  });

  it('do profissional no cartão vira lançamento no pagamento; na mão dele, não; da unidade, nunca', async () => {
    const appt = await appointment(shopId, proBarber);
    const card = await tips.add(users.dono, shopId, appt.id, {
      destination: 'professional',
      method: 'CARD',
      amount: 10.456,
    });
    expect(card).toMatchObject({
      amount: 10.46,
      receivedByUnit: true,
      currency: 'BRL',
      paidOut: false,
    });
    // O próprio profissional registra o Pix que recebeu direto
    const pix = await tips.add(users.pro, shopId, appt.id, {
      destination: 'professional',
      method: 'PIX',
      amount: 5,
    });
    expect(pix.receivedByUnit).toBe(false);
    // Dinheiro deixado no balcão pro profissional: a unidade repassa
    await tips.add(users.dono, shopId, appt.id, {
      destination: 'professional',
      method: 'CASH',
      amount: 7,
      receivedByUnit: true,
    });
    const unit = await tips.add(users.dono, shopId, appt.id, {
      destination: 'unit',
      method: 'CASH',
      amount: 20,
    });
    expect(unit).toMatchObject({ destination: 'unit', receivedByUnit: false, barberName: null });

    const entries = await prisma.barberPayEntry.findMany({
      where: { barbershopId: shopId, barberId: proBarber, type: 'TIP' },
    });
    expect(entries.map((e) => Number(e.amount)).sort()).toEqual([10.46, 7]);
    expect(entries[0].notes).toBe('Caixinha — Carla');

    const listed = await tips.list(users.pro, shopId, appt.id);
    expect(listed).toHaveLength(4);
  });

  it('quem não é da recepção nem atendeu não registra; só atendimento concluído; valor válido', async () => {
    const appt = await appointment(shopId, proBarber);
    await expect(
      tips.add(users.outro, shopId, appt.id, { destination: 'unit', method: 'CASH', amount: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const pending = await appointment(shopId, proBarber, 'CONFIRMED');
    await expect(
      tips.add(users.dono, shopId, pending.id, { destination: 'unit', method: 'CASH', amount: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      tips.add(users.dono, shopId, appt.id, { destination: 'unit', method: 'CASH', amount: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      tips.add(users.dono, shopId, appt.id, { destination: 'unit', method: 'CHEQUE', amount: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const solo = await appointment(soloShopId, soloBarber);
    await expect(
      tips.add(users.dono, soloShopId, solo.id, { destination: 'unit', method: 'CASH', amount: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('apagar leva o lançamento junto; depois do fechamento do pagamento não apaga', async () => {
    const appt = await appointment(shopId, proBarber);
    const first = await tips.add(users.dono, shopId, appt.id, {
      destination: 'professional',
      method: 'CARD',
      amount: 12,
    });
    const firstTip = await prisma.appointmentTip.findUniqueOrThrow({ where: { id: first.id } });
    await tips.remove(users.dono, shopId, first.id);
    expect(
      await prisma.barberPayEntry.findUnique({ where: { id: firstTip.payEntryId! } }),
    ).toBeNull();

    const second = await tips.add(users.dono, shopId, appt.id, {
      destination: 'professional',
      method: 'CARD',
      amount: 15,
    });
    const secondTip = await prisma.appointmentTip.findUniqueOrThrow({ where: { id: second.id } });
    const payout = await prisma.barberPayout.create({
      data: {
        barbershopId: shopId,
        barberId: proBarber,
        periodStart: new Date(Date.now() - 30 * 24 * HOUR),
        periodEnd: new Date(),
        payType: 'COMMISSION',
        serviceSales: 0,
        productSales: 0,
        salesCount: 0,
        commission: 0,
        fixedAmount: 0,
        baseAmount: 0,
        tips: 15,
        bonuses: 0,
        deductions: 0,
        advances: 0,
        total: 15,
        currency: 'BRL',
        method: 'PIX',
        paidAt: new Date(),
        createdByUserId: users.dono,
      },
    });
    await prisma.barberPayEntry.update({
      where: { id: secondTip.payEntryId! },
      data: { payoutId: payout.id },
    });
    expect(
      (await tips.list(users.dono, shopId, appt.id)).find((t) => t.id === second.id)?.paidOut,
    ).toBe(true);
    await expect(tips.remove(users.dono, shopId, second.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('pelo app: só pra quem tem conta de recebimento ativa; cai direto na conta, com a taxa', async () => {
    process.env.STRIPE_SECRET_KEY = '';
    const appt = await appointment(shopId, proBarber);
    const token = createReviewToken(appt.id);
    // Ninguém recebe pelo app ainda
    expect(await tips.appTipOptions(token)).toMatchObject({
      professional: false,
      unit: false,
      currency: 'BRL',
      professionalName: 'Pro',
    });
    await expect(tips.startAppTip(token, 'professional', 10)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // O profissional cria a conta dele (perfil de profissional primeiro)
    await expect(connect.startProfessionalOnboarding(users.pro)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const professional = await prisma.professional.create({
      data: { userId: users.pro, slug: `tip-pro-${RUN}` },
    });
    await prisma.barber.update({
      where: { id: proBarber },
      data: { professionalId: professional.id },
    });
    const { url } = await connect.startProfessionalOnboarding(users.pro);
    const accountId = new URL(url).searchParams.get('account')!;
    expect(new URL(url).searchParams.get('back')).toBe('https://app.test/profile-privacy');
    // Outra pessoa não conclui o cadastro de outra
    await expect(connect.completeFake(users.outro, accountId)).rejects.toThrow();
    await connect.completeFake(users.pro, accountId);
    expect(await connect.professionalStatus(users.pro)).toMatchObject({ chargesEnabled: true });
    expect(await tips.appTipOptions(token)).toMatchObject({ professional: true, unit: false });

    // Valor fora do limite não passa
    await expect(tips.startAppTip(token, 'professional', 0.5)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(tips.startAppTip(token, 'unit', 10)).rejects.toBeInstanceOf(BadRequestException);

    const started = await tips.startAppTip(token, 'professional', 20);
    const pi = intents.get(started.paymentIntentId);
    expect(pi).toMatchObject({
      amount: 2000,
      transfer_data: { destination: accountId },
      application_fee_amount: 300,
      metadata: {
        kind: 'appointment_tip',
        appointmentId: String(appt.id),
        destination: 'professional',
      },
    });

    // Não pago ainda: nada registrado
    expect(await tips.confirmAppTip(token, started.paymentIntentId)).toBe(false);
    pi.status = 'succeeded';
    expect(await tips.confirmAppTip(token, started.paymentIntentId)).toBe(true);
    // Webhook depois: não duplica
    await tips.finalizeAppTip(pi);
    const list = await tips.list(users.dono, shopId, appt.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      destination: 'professional',
      method: 'STRIPE',
      amount: 20,
      receivedByUnit: false,
      barberName: 'Pro',
    });
    expect((await tips.appTipOptions(token)).given).toEqual([
      { destination: 'professional', amount: 20 },
    ]);
    // Pagamento de outro atendimento não vale neste link
    const other = await appointment(shopId, proBarber);
    await expect(
      tips.confirmAppTip(createReviewToken(other.id), started.paymentIntentId),
    ).rejects.toBeInstanceOf(BadRequestException);
    // A equipe não apaga caixinha paga pelo app (o estorno é pelo Stripe)
    await expect(tips.remove(users.dono, shopId, list[0].id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Atendimento não concluído não recebe caixinha pelo link
    const open = await appointment(shopId, proBarber, 'CONFIRMED');
    await expect(tips.appTipOptions(createReviewToken(open.id))).rejects.toThrow();
  });
});
