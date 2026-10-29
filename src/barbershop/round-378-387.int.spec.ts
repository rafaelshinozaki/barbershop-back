/**
 * Itens 380, 381, 383 e 384: desfazer o cancelamento do clube, telefone
 * repetido e e-mail da ficha, perfil público sem a planilha, idade no
 * aceite do convite com conta que já existe.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { CareerService } from './career.service';
import { EmployeeInviteService } from './employee-invite.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Clube, ficha, perfil e convite (integração)', () => {
  const prisma = new PrismaService();
  const stripeUpdates: Array<{ id: string; data: { cancel_at_period_end?: boolean } }> = [];
  const stub = {} as never;
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    stub,
    {
      updateSubscription: async (id: string, data: { cancel_at_period_end?: boolean }) => {
        stripeUpdates.push({ id, data });
      },
    } as never,
    stub,
    { notify: () => undefined } as never,
  );
  const career = new CareerService(prisma, {
    summary: async () => ({ averageRating: null, reviewCount: 0 }),
    publicReviews: async () => [],
  } as never);
  const invites = new EmployeeInviteService(
    prisma,
    stub,
    { get: () => 'http://localhost:5173' } as never,
    stub,
    { notify: () => undefined } as never,
    { memberJoined: async () => undefined } as never,
  );

  let roleId: number;
  let ownerId: number;
  let proId: number;
  let youngId: number;
  let adultId: number;
  let networkId: number;
  let shopId: number;
  let serviceId: number;
  let planId: number;
  let accountId: number;
  let subscriptionId: number;
  const periodEnd = new Date(Date.now() + 20 * 86_400_000);
  const price = new Prisma.Decimal('79.90');

  const user = async (
    label: string,
    extra: { birthdate?: Date; emailVerifiedAt?: Date | null } = {},
  ) =>
    (
      await prisma.user.create({
        data: {
          email: `r378-${label}-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: `Pessoa ${label}`,
          idDocNumber: `r378${label}${RUN}`.slice(-20),
          phone: `+5511${label}${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: extra.birthdate ?? new Date('1990-01-01'),
          readTerms: true,
          roleId,
          emailVerifiedAt: extra.emailVerifiedAt === undefined ? new Date() : extra.emailVerifiedAt,
        },
      })
    ).id;

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await user('dono');
    proId = await user('pro');
    youngId = await user('jovem', { birthdate: new Date('2011-10-29T00:00:00Z') });
    adultId = await user('adulto', { birthdate: new Date('2008-10-29T00:00:00Z') });
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Unidade 378',
          slug: `r378-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r378-shop-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    serviceId = (
      await prisma.barbershopService.create({
        data: {
          barbershopId: shopId,
          name: 'Corte',
          durationMinutes: 30,
          price: new Prisma.Decimal(50),
        },
      })
    ).id;
    planId = (
      await prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: shopId,
          serviceId,
          name: 'Clube',
          price: new Prisma.Decimal(90),
          sessionsPerCycle: 4,
        },
      })
    ).id;
    accountId = (
      await prisma.clientAccount.create({
        data: { email: `r378-cli-${RUN}@test.local`, name: 'Cliente Clube', emailVerifiedAt: new Date() },
      })
    ).id;
    subscriptionId = (
      await prisma.clientSubscription.create({
        data: {
          barbershopId: shopId,
          clientAccountId: accountId,
          planId,
          stripeSubscriptionId: `sub_r378_${RUN}`,
          status: 'ACTIVE',
          currentPeriodEnd: periodEnd,
          price,
          cancelAtPeriodEnd: false,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.employeeInvite.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.clientSubscription.deleteMany({ where: { id: subscriptionId } });
    await prisma.clientSubscriptionPlan.deleteMany({ where: { id: planId } });
    await prisma.clientAccount.deleteMany({ where: { id: accountId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.professional.deleteMany({ where: { userId: proId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.user.deleteMany({
      where: { email: { in: [`r378-dono-${RUN}@test.local`, `r378-pro-${RUN}@test.local`, `r378-jovem-${RUN}@test.local`, `r378-adulto-${RUN}@test.local`] } },
    });
    await prisma.$disconnect();
  });

  it('cancelar e desfazer deixa a assinatura ativa, com a mesma renovação e o mesmo preço', async () => {
    await shops.cancelMySubscription(accountId, subscriptionId);
    await shops.resumeMySubscription(accountId, subscriptionId);
    const row = await prisma.clientSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(row.status).toBe('ACTIVE');
    expect(row.cancelAtPeriodEnd).toBe(false);
    expect(row.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString());
    expect(row.price?.toFixed(2)).toBe('79.90');
    expect(stripeUpdates.map((call) => call.data.cancel_at_period_end)).toEqual([true, false]);
  });

  it('telefone repetido avisa a ficha existente; e-mail inválido é recusado e o válido vai em minúsculas', async () => {
    const digits = `11${RUN.replace(/\D/g, '').slice(-9).padStart(9, '0')}`;
    const formatted = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    const existing = await shops.createCustomer(ownerId, shopId, {
      name: 'Ana Ficha',
      phone: digits,
      email: 'Ana@Email.com',
    });
    expect(existing.email).toBe('ana@email.com');
    try {
      await shops.createCustomer(ownerId, shopId, { name: 'Outra', phone: formatted });
      throw new Error('deveria avisar o telefone repetido');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        message: 'Já existe uma ficha com este telefone.',
        customerId: existing.id,
        customerName: 'Ana Ficha',
      });
    }
    await expect(
      shops.createCustomer(ownerId, shopId, { name: 'Ruim', phone: `22${digits.slice(2)}`, email: 'a@b' }),
    ).rejects.toThrow('E-mail inválido');
    const kept = await shops.updateCustomer(ownerId, shopId, existing.id, { phone: formatted });
    expect(kept.id).toBe(existing.id);
  });

  it('perfil público conta 3 atendimentos do app e deixa de fora os 50 importados', async () => {
    const professional = await prisma.professional.create({
      data: { userId: proId, slug: `pro-${RUN}`, visibility: 'public', isPublic: true },
    });
    const barber = await prisma.barber.create({
      data: {
        barbershopId: shopId,
        userId: proId,
        professionalId: professional.id,
        name: 'Pro Público',
        phone: '11900001111',
      },
    });
    const customer = await prisma.customer.create({
      data: { networkId, name: 'Quem veio', phone: `33${RUN.slice(-9)}` },
    });
    const slot = (day: number, source: 'PHONE' | 'IMPORT') => {
      const startAt = new Date(Date.UTC(2024, 0, day, 15, 0, 0));
      return {
        barbershopId: shopId,
        customerId: customer.id,
        barberId: barber.id,
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        status: 'COMPLETED',
        source,
      };
    };
    await prisma.appointment.createMany({
      data: [
        slot(1, 'PHONE'),
        slot(2, 'PHONE'),
        slot(3, 'PHONE'),
        ...Array.from({ length: 50 }, (_, index) => slot(10 + index, 'IMPORT')),
      ],
    });
    const page = await career.publicProfile(`pro-${RUN}`);
    expect(page.completedAppointments).toBe(3);
    const mine = await career.overview(proId);
    expect(mine.completedAppointments).toBe(3);
    expect(mine.importedAppointments).toBe(50);
  });

  it('conta com 15 anos não entra na equipe; com 18, entra', async () => {
    const seat = async (label: string) =>
      (
        await prisma.barber.create({
          data: { barbershopId: shopId, name: label, phone: `119${label.length}${RUN}`.slice(0, 20) },
        })
      ).id;
    const youngSeat = await seat('jovem');
    const adultSeat = await seat('adulto');
    const inviteFor = async (barberId: number, email: string) =>
      (
        await prisma.employeeInvite.create({
          data: {
            inviterId: ownerId,
            barbershopId: shopId,
            barberId,
            email,
            inviteToken: `tok-${barberId}-${RUN}`,
            role: 'BarbershopEmployee',
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
          },
        })
      ).inviteToken;
    const youngEmail = `r378-jovem-${RUN}@test.local`;
    const adultEmail = `r378-adulto-${RUN}@test.local`;
    await expect(invites.acceptInviteAsUser(await inviteFor(youngSeat, youngEmail), youngId)).rejects.toThrow(
      'Para trabalhar é preciso ter 16 anos.',
    );
    expect((await prisma.barber.findUniqueOrThrow({ where: { id: youngSeat } })).userId).toBeNull();
    const accepted = await invites.acceptInviteAsUser(await inviteFor(adultSeat, adultEmail), adultId);
    expect(accepted.success).toBe(true);
    expect((await prisma.barber.findUniqueOrThrow({ where: { id: adultSeat } })).userId).toBe(adultId);
  });
});
