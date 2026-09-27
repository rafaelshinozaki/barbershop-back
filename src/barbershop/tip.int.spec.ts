import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { TipService } from './tip.service';

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
  const tips = new TipService(prisma, barbershops);

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

  afterAll(async () => {
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
});
