/**
 * Taxa de falta e de cancelamento tardio, contra o Postgres de verdade:
 * cancelamento pela unidade não gera taxa, falta desfeita tira a pendente, e
 * a taxa recebida entra como venda no caixa aberto.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const HOUR = 3_600_000;

// A taxa é registrada em segundo plano: espera aparecer (ou não)
async function waitFor(check: () => Promise<boolean>, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('Taxa de falta (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  let ownerId: number;
  let basicId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let serviceId: number;
  let customerId: number;

  const user = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `nsf-${label}-${RUN}@test.local`,
          isActive: true,
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

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await user('dona', roleId);
    basicId = await user('basico', roleId);
    networkId = (
      await prisma.network.create({
        data: {
          ownerUserId: ownerId,
          name: `Rede Taxa ${RUN}`,
          noShowFeeEnabled: true,
          noShowFeeType: 'FIXED',
          noShowFeeValue: 30,
          lateCancellationWindowHours: 24,
        },
      })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Taxa',
          slug: `nsf-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `nsf-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Ana', phone: '11911111111' },
      })
    ).id;
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Básico',
        phone: '11933333333',
        userId: basicId,
        staffType: 'basic',
      },
    });
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(80) },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Cliente Taxa', phone: `5${RUN.slice(-10)}` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  // Dentro da janela de 24 h de cancelamento tardio, um horário por agendamento
  let slot = 0;
  const appointment = async () => {
    const start = new Date(Date.now() + 2 * HOUR + slot++ * HOUR);
    const a = await shops.createAppointment(ownerId, shopId, {
      customerId,
      barberId,
      startAt: start,
      endAt: new Date(start.getTime() + 30 * 60_000),
      services: [{ serviceId, unitPrice: 80 }],
    });
    return a!.id;
  };
  const feeOf = (appointmentId: number) =>
    prisma.noShowFee.findUnique({ where: { appointmentId } });

  it('cancelamento tardio: só gera taxa quando quem cancelou foi o cliente', async () => {
    const byShop = await appointment();
    await shops.updateAppointment(
      ownerId,
      shopId,
      byShop,
      { status: 'CANCELLED' },
      {
        cancelledBy: 'business',
      },
    );
    expect(await waitFor(async () => !!(await feeOf(byShop)), 500)).toBe(false);

    const byClient = await appointment();
    await shops.updateAppointment(
      ownerId,
      shopId,
      byClient,
      { status: 'CANCELLED' },
      {
        cancelledBy: 'client',
      },
    );
    expect(await waitFor(async () => !!(await feeOf(byClient)))).toBe(true);
    expect(await feeOf(byClient)).toMatchObject({ reason: 'LATE_CANCELLATION', status: 'PENDING' });

    await expect(
      shops.updateAppointment(
        ownerId,
        shopId,
        await appointment(),
        { status: 'CANCELLED' },
        {
          cancelledBy: 'ninguém',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falta marcada por engano e corrigida: a taxa pendente sai; marcada de novo, volta', async () => {
    const id = await appointment();
    await shops.updateAppointment(ownerId, shopId, id, { status: 'NO_SHOW' });
    expect(await waitFor(async () => !!(await feeOf(id)))).toBe(true);
    await shops.updateAppointment(ownerId, shopId, id, { status: 'COMPLETED' });
    expect(await feeOf(id)).toBeNull();
    await shops.updateAppointment(ownerId, shopId, id, { status: 'NO_SHOW' });
    expect(await waitFor(async () => (await feeOf(id))?.status === 'PENDING')).toBe(true);
  });

  it('taxa recebida: pede a forma de pagamento e entra como venda no caixa aberto', async () => {
    const id = await appointment();
    await shops.updateAppointment(ownerId, shopId, id, { status: 'NO_SHOW' });
    expect(await waitFor(async () => !!(await feeOf(id)))).toBe(true);
    const fee = (await feeOf(id))!;
    const cash = await prisma.cashSession.create({
      data: { barbershopId: shopId, openedByUserId: ownerId, openingBalance: new Decimal(0) },
    });

    await expect(shops.markNoShowFeeCollected(ownerId, shopId, fee.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Barbeiro básico não marca
    await expect(
      shops.markNoShowFeeCollected(basicId, shopId, fee.id, 'CASH'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await shops.markNoShowFeeCollected(ownerId, shopId, fee.id, 'CASH');
    const collected = await prisma.noShowFee.findUniqueOrThrow({ where: { id: fee.id } });
    expect(collected.status).toBe('COLLECTED');
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: collected.saleId! } });
    expect(sale).toMatchObject({
      saleType: 'NO_SHOW_FEE',
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      cashSessionId: cash.id,
      customerId,
    });
    expect(Number(sale.total)).toBe(30);
    // Clicar de novo não lança outra venda
    await expect(
      shops.markNoShowFeeCollected(ownerId, shopId, fee.id, 'CASH'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.sale.count({ where: { barbershopId: shopId } })).toBe(1);
    // Já recebida: desfazer a falta não apaga
    await shops.updateAppointment(ownerId, shopId, id, { status: 'COMPLETED' });
    expect((await feeOf(id))?.status).toBe('COLLECTED');

    // Apagar a venda da taxa: a taxa volta a ficar pendente
    await shops.deleteSale(ownerId, shopId, sale.id);
    expect(await prisma.noShowFee.findUniqueOrThrow({ where: { id: fee.id } })).toMatchObject({
      status: 'PENDING',
      saleId: null,
      collectedAt: null,
    });
  });
});
