/**
 * Itens 287 a 289: pagamento pelo app que conclui com a conta já fechada
 * volta inteiro (e fechar a conta cancela o pagamento aberto), os totais do
 * Financeiro saem por moeda, e o cabeçalho da página pública segue o idioma
 * do país da unidade.
 */
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { PrepaymentService } from './prepayment.service';
import { AppPaymentsService } from './app-payments.service';
import { ShopSeoService } from '../seo/shop-seo.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86_400_000;

describe('Itens 287 a 289 (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const cancelled: string[] = [];
  const refunds: Array<{ id: string; key: string }> = [];
  const stripe = {
    cancelPaymentIntent: async (id: string) => void cancelled.push(id),
    createRefund: async (id: string, _a: unknown, _r: unknown, key: string) =>
      void refunds.push({ id, key }),
  };
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stripe as never,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const prepayment = new PrepaymentService(prisma, stripe as never, shops, stub);
  let ownerId: number;
  let networkId: number;
  const shopIds: number[] = [];
  let barberId: number;
  let customerId: number;

  const shop = (label: string, currency: string, country: string) =>
    prisma.barbershop.create({
      data: {
        name: `Unidade ${label}`,
        slug: `r287-${label}-${RUN}`,
        address: 'Rua A, 1',
        city: 'SP',
        state: 'SP',
        country,
        currency,
        postalCode: '01000000',
        phone: '11999999999',
        email: `r287-${label}-${RUN}@test.local`,
        timezone: 'America/Sao_Paulo',
        networkId,
        ownerUserId: ownerId,
      },
    });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `r287-dona-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Dona',
          idDocNumber: `r287${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede 287 ${RUN}` } })
    ).id;
    shopIds.push((await shop('br', 'BRL', 'BR')).id, (await shop('us', 'USD', 'US')).id);
    barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopIds[0], name: 'Barbeiro', phone: '11900000001' },
      })
    ).id;
    customerId = (
      await prisma.customer.create({ data: { networkId, name: 'Cliente', phone: '11977770001' } })
    ).id;
  });

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.appointment.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.barber.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  const appointment = (barbershopId: number, data: object = {}) => {
    const startAt = new Date(Date.now() - DAY);
    return prisma.appointment.create({
      data: {
        barbershopId,
        barberId,
        customerId,
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        status: 'CONFIRMED',
        ...data,
      },
    });
  };

  it('287: pagamento que conclui depois de a conta ser fechada volta inteiro', async () => {
    const appt = await appointment(shopIds[0], { prepaidPaymentIntentId: `pi_open_${RUN}` });
    // A equipe fecha a conta no balcão com o pagamento pelo app em aberto
    await shops.createSale(ownerId, shopIds[0], {
      appointmentId: appt.id,
      saleType: 'SERVICE',
      items: [{ itemType: 'SERVICE', quantity: 1, unitPrice: 50, totalPrice: 50 }],
      subtotal: 50,
      total: 50,
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
    });
    expect(cancelled).toContain(`pi_open_${RUN}`);

    // O cartão foi confirmado mesmo assim (a aba antiga): estorna, não registra
    const ok = await prepayment.finalize({
      id: `pi_open_${RUN}`,
      status: 'succeeded',
      amount: 5000,
      currency: 'brl',
      metadata: { appointmentId: String(appt.id) },
    } as never);
    expect(ok).toBe(false);
    expect(refunds).toContainEqual({ id: `pi_open_${RUN}`, key: `prepaid-extra:pi_open_${RUN}` });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(row.prepaidAt).toBeNull();
  });

  it('288: os totais do Financeiro saem por moeda', async () => {
    const paidAt = new Date();
    await appointment(shopIds[0], {
      depositPaymentIntentId: `pi_br_${RUN}`,
      depositPaidAt: paidAt,
      depositPaid: true,
      depositAmount: 100,
    });
    await appointment(shopIds[1], {
      depositPaymentIntentId: `pi_us_${RUN}`,
      depositPaidAt: paidAt,
      depositPaid: true,
      depositAmount: 100,
    });
    const payments = new AppPaymentsService(prisma, shops, stripe as never);
    const both = await payments.list({ kind: 'deposit', from: new Date(paidAt.getTime() - 1000) });
    const mine = both.byCurrency.filter((g) => ['BRL', 'USD'].includes(g.currency));
    expect(mine.map((g) => g.currency)).toEqual(['BRL', 'USD']);
    // Mais de uma moeda: não soma reais com dólares na raiz
    expect(both.amount).toBe(0);
    const one = await payments.list({ kind: 'deposit', barbershopId: shopIds[1] });
    expect(one.byCurrency).toEqual([expect.objectContaining({ currency: 'USD', amount: 100 })]);
    expect(one.amount).toBe(100);
  });

  it('289: o cabeçalho da página pública segue o idioma do país', async () => {
    const base = {
      slug: 'x',
      name: 'Studio',
      city: 'Miami',
      state: 'FL',
      reviewCount: 2,
      averageRating: 4.5,
      openingHours: [],
      services: [],
      currency: 'USD',
    };
    const seo = (shop: object) =>
      new ShopSeoService({ getPublicBarbershopByslug: async () => shop } as never).forSlug('x');
    const us = await seo({ ...base, country: 'US' });
    expect(us.title).toBe('Studio · Miami - FL | Book online');
    expect(us.description).toBe('Book online at Studio, Miami - FL. ★ 4.5 (2 reviews).');
    expect((await seo({ ...base, country: 'ES' })).title).toContain('Reserva online');
    expect((await seo({ ...base, country: 'BR' })).title).toContain('Agende online');
  });
});
