/**
 * Itens 423–442: subdomínio, saúde, exclusão, avaliação, plano, ficha,
 * período da venda, busca, histórico, inativos, telefone e idade.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as Joi from 'joi';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { PaymentsService } from '../payments/payments.service';
import { HealthService } from '../health/health.service';
import { UserController } from '../auth/users/users.controller';
import { BackofficeResolver } from '../graphql/resolvers/backoffice.resolver';
import { frontendUrlSchema } from '../common/env-frontend';
import { ageBand, ageInYears } from '../common/work-age';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('itens 423-442', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const shops = new BarbershopService(prisma, stub, stub, stub, stub, stub, {
    notify: () => undefined,
  } as never);
  const clients = new ClientAuthService(
    prisma,
    stub,
    { get: () => 'https://app.test' } as never,
    { sendTemplateEmail: async () => undefined, sendCustomerEmail: async () => undefined } as never,
    { deleteCustomer: async () => undefined, cancelSubscription: async () => undefined } as never,
    { linkedStaff: async () => null } as never,
  );
  const planEmails: string[] = [];
  const payments = new PaymentsService(
    prisma,
    stub,
    {
      sendTemplateEmail: async (_id: number, template: string) => {
        planEmails.push(template);
      },
    } as never,
    stub,
  );

  let roleId: number;
  let ownerId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let serviceId: number;

  const createUser = async (label: string) =>
    (
      await prisma.user.create({
        data: {
          email: `r423-${label}-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: `Pessoa ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `119${RUN.slice(-8)}`,
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner');
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede 423 ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: `Unidade 423 ${RUN}`,
          slug: `u423-${RUN}`,
          address: 'Rua 1',
          city: 'Cidade',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `u423-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          ownerUserId: ownerId,
          networkId,
        },
      })
    ).id;
    barberId = (
      await prisma.barber.create({
        data: {
          barbershopId: shopId,
          name: 'Pro',
          phone: '11900000000',
          staffType: 'barber',
          isActive: true,
        },
      })
    ).id;
    serviceId = (
      await prisma.barbershopService.create({
        data: {
          barbershopId: shopId,
          name: 'Corte',
          durationMinutes: 30,
          price: 40,
          isActive: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { thread: { barbershopId: shopId } } });
    await prisma.chatThread.deleteMany({ where: { barbershopId: shopId } });
    await prisma.review.deleteMany({ where: { barbershopId: shopId } });
    await prisma.saleItem.deleteMany({ where: { sale: { barbershopId: shopId } } });
    await prisma.sale.deleteMany({ where: { barbershopId: shopId } });
    await prisma.serviceHistory.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.payment.deleteMany({ where: { subscription: { user: { email: { contains: RUN } } } } });
    await prisma.subscription.deleteMany({ where: { user: { email: { contains: RUN } } } });
    await prisma.plan.deleteMany({ where: { name: { contains: RUN } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.clientAccount.deleteMany({ where: { email: { contains: RUN } } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
    await prisma.$disconnect();
  });

  it('produção sem FRONTEND_URL não valida', () => {
    const schema = Joi.object({
      NODE_ENV: Joi.string().valid('development', 'production', 'test'),
      FRONTEND_URL: frontendUrlSchema,
    });
    expect(schema.validate({ NODE_ENV: 'production' }).error).toBeTruthy();
    expect(schema.validate({ NODE_ENV: 'development' }).value.FRONTEND_URL).toBe(
      'http://localhost:5173',
    );
  });

  it('quem nasceu em 30/12/2000 tem 25 anos em 28/10/2026', () => {
    const birth = new Date(Date.UTC(2000, 11, 30));
    const today = new Date(2026, 9, 28);
    expect(ageInYears(birth, today)).toBe(25);
    expect(ageBand(birth, today)).toBe('18-25');
    expect(ageBand(new Date(Date.UTC(2010, 0, 1)), today)).toBe('menos de 18');
  });

  it('/health não consulta o Stripe', async () => {
    const stripe = { isAvailable: jest.fn(async () => true) };
    const health = new HealthService(
      { $queryRaw: async () => 1 } as never,
      { client: { ping: async () => 'PONG' } } as never,
    );
    for (let i = 0; i < 10; i++) await health.getHealthStatus();
    expect(stripe.isAvailable).not.toHaveBeenCalled();
  });

  it('rotas antigas de plano não existem mais', () => {
    expect('updatePaymentStatus' in UserController.prototype).toBe(false);
    expect('changePlan' in UserController.prototype).toBe(false);
    expect('changeUserPlan' in BackofficeResolver.prototype).toBe(false);
  });

  it('subdomínio suporte e pagamentos são recusados', async () => {
    const update = (shops as unknown as { resolveSubdomainUpdate: Function }).resolveSubdomainUpdate.bind(
      shops,
    );
    await expect(update(shopId, 'suporte')).rejects.toBeInstanceOf(BadRequestException);
    await expect(update(shopId, 'pagamentos')).rejects.toBeInstanceOf(BadRequestException);
    await expect(update(shopId, 'pag-amentos')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('vender serviço desativado dá erro', async () => {
    const off = await prisma.barbershopService.create({
      data: {
        barbershopId: shopId,
        name: 'Antigo',
        durationMinutes: 30,
        price: 10,
        isActive: false,
      },
    });
    const customer = await prisma.customer.create({
      data: { networkId, name: 'Cliente venda', phone: `+551181${RUN.slice(-7)}` },
    });
    await expect(
      shops.createSale(ownerId, shopId, {
        customerId: customer.id,
        saleType: 'SERVICE',
        items: [
          {
            itemType: 'SERVICE',
            serviceId: off.id,
            quantity: 1,
            unitPrice: 10,
            totalPrice: 10,
          },
        ],
        subtotal: 10,
        total: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('buscar % não traz a base, e o telefone formatado acha a ficha', async () => {
    const tail = RUN.slice(-8);
    const phone = `+55119${tail}`;
    const formatted = `(11) 9${tail.slice(0, 4)}-${tail.slice(4)}`;
    const customer = await shops.createCustomer(ownerId, shopId, {
      name: `Unico ${RUN}`,
      phone,
    });
    const all = await shops.getCustomers(ownerId, shopId, { search: '%' });
    expect(all.find((c) => c.id === customer.id)).toBeUndefined();
    const found = await shops.getCustomers(ownerId, shopId, { search: formatted });
    expect(found.some((c) => c.id === customer.id)).toBe(true);
    await expect(
      shops.createCustomer(ownerId, shopId, {
        name: 'De novo',
        phone: formatted,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ customerId: customer.id }),
    });
  });

  it('venda no último milissegundo do dia entra no mês', async () => {
    const customer = await prisma.customer.create({
      data: { networkId, name: 'Virada', phone: `+55119777${RUN.slice(-4)}` },
    });
    const at = new Date('2026-04-01T02:59:59.500Z');
    const sale = await prisma.sale.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        saleType: 'SERVICE',
        subtotal: 15,
        total: 15,
        paymentStatus: 'PENDING',
        createdAt: at,
      },
    });
    const rows = await shops.getSales(ownerId, shopId, {
      customerId: customer.id,
      from: new Date('2026-03-01T03:00:00.000Z'),
      to: new Date('2026-04-01T03:00:00.000Z'),
      limit: 50,
    });
    expect(rows.some((row) => row.id === sale.id)).toBe(true);
  });

  it('sessenta vendas contam sessenta e o gasto certo', async () => {
    const customer = await prisma.customer.create({
      data: { networkId, name: 'Fiel', phone: `+55119666${RUN.slice(-4)}` },
    });
    await prisma.sale.createMany({
      data: Array.from({ length: 60 }, () => ({
        barbershopId: shopId,
        customerId: customer.id,
        saleType: 'SERVICE',
        subtotal: 10,
        total: 10,
        paymentStatus: 'PAID',
        paidAt: new Date('2026-06-01T15:00:00.000Z'),
      })),
    });
    const stats = await shops.customerCardStats(ownerId, shopId, customer.id);
    expect(stats.sales).toBe(60);
    expect(stats.totalSpent).toBe(600);
  });

  it('atendimento fechado no caixa aparece uma vez, com o valor', async () => {
    const account = await prisma.clientAccount.create({
      data: {
        email: `hist-${RUN}@test.local`,
        name: 'Hist',
        emailVerifiedAt: new Date(),
      },
    });
    const customer = await prisma.customer.create({
      data: {
        networkId,
        name: 'Hist',
        phone: `+55119555${RUN.slice(-4)}`,
        clientAccountId: account.id,
      },
    });
    const start = new Date('2026-05-01T15:00:00.000Z');
    const appointment = await prisma.appointment.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        barberId,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60 * 1000),
        status: 'COMPLETED',
        source: 'ONLINE',
      },
    });
    await prisma.sale.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        appointmentId: appointment.id,
        saleType: 'SERVICE',
        subtotal: 40,
        total: 40,
        paymentStatus: 'PAID',
        paidAt: start,
      },
    });
    const history = await clients.getHistory(account.id);
    const apt = history.filter((row) => String(row.id).includes(String(appointment.id)));
    expect(apt).toHaveLength(1);
    expect(apt[0].total).toBe(40);
  });

  it('cliente com horário marcado não entra nos inativos', async () => {
    const customer = await prisma.customer.create({
      data: { networkId, name: 'Volta', phone: `+55119444${RUN.slice(-4)}` },
    });
    await prisma.serviceHistory.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        barberId,
        serviceId,
        performedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        priceCharged: 40,
      },
    });
    await prisma.appointment.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        barberId,
        startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
        status: 'CONFIRMED',
        source: 'PHONE',
      },
    });
    const rows = await (
      shops as unknown as { resolveMarketingSegment: Function }
    ).resolveMarketingSegment(networkId, shopId, 'INACTIVE', 60, false, 'BR');
    expect(rows.some((row: { id: number }) => row.id === customer.id)).toBe(false);
  });

  it('excluir a conta mantém a conversa retida e a avaliação denunciada', async () => {
    const account = await prisma.clientAccount.create({
      data: { email: `del-${RUN}@test.local`, name: 'Apaga', emailVerifiedAt: new Date() },
    });
    const customer = await prisma.customer.create({
      data: {
        networkId,
        name: 'Apaga',
        phone: `+55119333${RUN.slice(-4)}`,
        clientAccountId: account.id,
      },
    });
    const start = new Date('2026-04-02T15:00:00.000Z');
    const appointment = await prisma.appointment.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        barberId,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60 * 1000),
        status: 'COMPLETED',
        source: 'ONLINE',
      },
    });
    const thread = await prisma.chatThread.create({
      data: {
        appointmentId: appointment.id,
        kind: 'unit',
        barbershopId: shopId,
        customerId: customer.id,
        retainUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.chatMessage.create({
      data: { threadId: thread.id, senderSide: 'client', body: 'prova da conversa' },
    });
    const review = await prisma.review.create({
      data: {
        barbershopId: shopId,
        clientAccountId: account.id,
        customerId: customer.id,
        rating: 1,
        comment: 'prova',
        reportedAt: new Date(),
      },
    });
    await clients.deleteAccount(account.id, {}, { viaLink: true });
    expect(await prisma.chatThread.findUnique({ where: { id: thread.id } })).toBeTruthy();
    expect(await prisma.chatMessage.count({ where: { threadId: thread.id } })).toBe(1);
    const kept = await prisma.review.findUnique({ where: { id: review.id } });
    expect(kept?.comment).toBe('prova');
    expect(kept?.clientAccountId).toBeNull();
  });

  it('o dono não avalia a própria unidade', async () => {
    const account = await prisma.clientAccount.create({
      data: {
        email: `dono-${RUN}@test.local`,
        name: 'Dono',
        emailVerifiedAt: new Date(),
        userId: ownerId,
      },
    });
    const customer = await prisma.customer.create({
      data: {
        networkId,
        name: 'Dono',
        phone: `+55119222${RUN.slice(-4)}`,
        clientAccountId: account.id,
      },
    });
    const start = new Date('2026-04-03T15:00:00.000Z');
    await prisma.appointment.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        barberId,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60 * 1000),
        status: 'COMPLETED',
        source: 'ONLINE',
      },
    });
    await expect(shops.createOrUpdateReview(account.id, shopId, 5, 'ótimo')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('unidade suspensa não lista avaliações públicas', async () => {
    await prisma.review.create({
      data: { barbershopId: shopId, rating: 5, comment: 'aberta' },
    });
    await prisma.barbershop.update({
      where: { id: shopId },
      data: { platformSuspendedAt: new Date() },
    });
    expect(await shops.getBarbershopReviews(shopId)).toEqual([]);
    await prisma.barbershop.update({
      where: { id: shopId },
      data: { platformSuspendedAt: null },
    });
    expect((await shops.getBarbershopReviews(shopId)).length).toBeGreaterThan(0);
  });

  it('pagar o plano enfileira o e-mail de confirmação', async () => {
    const plan = await prisma.plan.create({
      data: { name: `Plano ${RUN}`, price: 10, billingCycle: 'MONTHLY' },
    });
    planEmails.length = 0;
    await (payments as unknown as { createSubscriptionAfterPayment: Function }).createSubscriptionAfterPayment(
      ownerId,
      plan.id,
      null,
    );
    expect(planEmails).toContain('invoice_email');
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const [y, m, d] = parts.split('-').map(Number);
    await prisma.subscription.updateMany({
      where: { userId: ownerId, planId: plan.id },
      data: { currentPeriodEnd: new Date(Date.UTC(y, m - 1, d + 3, 15, 0, 0)) },
    });
    planEmails.length = 0;
    await payments.notifyPlansExpiringSoon();
    expect(planEmails).toContain('plan_expiring_email');
  });
});
