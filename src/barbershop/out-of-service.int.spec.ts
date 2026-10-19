/**
 * Unidade fora do ar pelos links do atendimento (item 190) e campanha sem
 * repetidos (item 191), contra o Postgres de verdade.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { createAppointmentToken, createReviewToken } from './appointment-link';
import { BarbershopService } from './barbershop.service';
import { ChatService } from './chat.service';
import { ReviewRequestService } from './review-request.service';
import { TipService } from './tip.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Unidade fora do ar e campanha sem repetidos (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const queued: unknown[] = [];
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => true } as never,
    stub,
    {
      email: async () => undefined,
      whatsapp: async () => undefined,
      emailBulk: async (jobs: unknown[]) => void queued.push(...jobs),
      whatsappBulk: async (jobs: unknown[]) => void queued.push(...jobs),
    } as never,
    { notify: () => undefined } as never,
  );
  const tips = new TipService(prisma, shops, stub, {
    destination: async () => 'acct_destino',
  } as never);
  const reviews = new ReviewRequestService(
    prisma,
    { email: async () => undefined } as never,
    { reviewPosted: async () => undefined } as never,
    shops,
  );
  const chat = new ChatService(
    prisma,
    shops,
    { email: async () => undefined } as never,
    { notifyUsers: () => undefined, notify: () => undefined } as never,
    stub,
    { sendToUsers: async () => undefined, sendToClient: async () => undefined } as never,
  );

  let ownerId: number;
  let proUserId: number;
  let networkId: number;
  let shopId: number;
  let apptId: number;
  let professionalId: number;

  const user = async (label: string) =>
    (
      await prisma.user.create({
        data: {
          email: `oos-${label}-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: `Pessoa ${label}`,
          idDocNumber: `${label}${RUN}`.slice(-20),
          phone: `+5511${RUN}${label.length}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId: (
            (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
            (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
          ).id,
        },
      })
    ).id;

  beforeAll(async () => {
    ownerId = await user('dona');
    proUserId = await user('pro');
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Fora do ar',
          slug: `oos-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `oos-shop-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    professionalId = (
      await prisma.professional.create({
        data: { userId: proUserId, slug: `oos-pro-${RUN}` },
      })
    ).id;
    const barber = await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Ana',
        phone: '11911111111',
        userId: proUserId,
        professionalId,
      },
    });
    const service = await prisma.barbershopService.create({
      data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
    });
    const customer = await prisma.customer.create({
      data: {
        networkId,
        name: 'Cliente Fiel',
        phone: '+5511988880000',
        email: `oos-cli-${RUN}@test.local`,
      },
    });
    apptId = (
      await prisma.appointment.create({
        data: {
          barbershopId: shopId,
          customerId: customer.id,
          barberId: barber.id,
          startAt: new Date(Date.now() - 2 * 3_600_000),
          endAt: new Date(Date.now() - 3_600_000),
          status: 'COMPLETED',
          services: { create: [{ serviceId: service.id, unitPrice: new Decimal(50) }] },
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.professional.deleteMany({ where: { id: professionalId } });
    await prisma.userNotification.deleteMany({
      where: { user: { email: { endsWith: `-${RUN}@test.local` } } },
    });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  const reviewToken = () => createReviewToken(apptId);
  const client = () => ({ side: 'client' as const, manageToken: createAppointmentToken(apptId) });

  it('no ar: caixinha, avaliação e conversa funcionam; profissional suspenso não recebe caixinha', async () => {
    expect(await tips.appTipOptions(reviewToken())).toMatchObject({
      professional: true,
      unit: true,
    });
    await expect(reviews.getReviewRequest(reviewToken())).resolves.toBeTruthy();
    await expect(chat.send(apptId, 'unit', 'Oi!', client())).resolves.toBeTruthy();

    await prisma.professional.update({
      where: { id: professionalId },
      data: { suspendedAt: new Date() },
    });
    try {
      expect(await tips.appTipOptions(reviewToken())).toMatchObject({
        professional: false,
        unit: true,
      });
      await expect(tips.startAppTip(reviewToken(), 'professional', 10)).rejects.toThrow(
        'ainda não recebe',
      );
    } finally {
      await prisma.professional.update({
        where: { id: professionalId },
        data: { suspendedAt: null },
      });
    }
  });

  it('suspensa pela plataforma (ela ou a rede): os links recusam e a campanha não sai', async () => {
    for (const suspend of [
      () =>
        prisma.barbershop.update({
          where: { id: shopId },
          data: { platformSuspendedAt: new Date() },
        }),
      () =>
        prisma.network.update({
          where: { id: networkId },
          data: { platformSuspendedAt: new Date() },
        }),
    ]) {
      await suspend();
      try {
        await expect(tips.appTipOptions(reviewToken())).rejects.toThrow('não está recebendo');
        await expect(tips.startAppTip(reviewToken(), 'unit', 10)).rejects.toThrow(
          'não está recebendo',
        );
        await expect(reviews.getReviewRequest(reviewToken())).rejects.toThrow('não está recebendo');
        await expect(reviews.submitReview(reviewToken(), { rating: 5 })).rejects.toThrow(
          'não está recebendo',
        );
        await expect(chat.send(apptId, 'unit', 'Alô?', client())).rejects.toThrow(
          'não está recebendo',
        );
        await expect(
          shops.sendMarketingBlast(ownerId, shopId, {
            message: 'Promoção',
            segment: 'ALL',
            sendEmail: true,
            sendWhatsapp: false,
          }),
        ).rejects.toThrow('suspensa pela plataforma');
      } finally {
        await prisma.barbershop.update({
          where: { id: shopId },
          data: { platformSuspendedAt: null },
        });
        await prisma.network.update({
          where: { id: networkId },
          data: { platformSuspendedAt: null },
        });
      }
    }
  });

  it('campanha: fichas repetidas recebem uma vez; quem saiu numa ficha não recebe pela outra (item 191)', async () => {
    await prisma.customer.createMany({
      data: [
        // A mesma pessoa: o telefone em outro formato, e-mail em outra caixa
        { networkId, name: 'Repetida 1', phone: '11977770001', email: `rep-${RUN}@test.local` },
        { networkId, name: 'Repetida 2', phone: '+5511977770001', email: null },
        { networkId, name: 'Repetida 3', phone: '11966660000', email: `REP-${RUN}@TEST.LOCAL` },
        // Saiu das campanhas numa ficha; a outra tem o mesmo telefone e outro e-mail
        {
          networkId,
          name: 'Saiu',
          phone: '(11) 95555-0000',
          email: `saiu-${RUN}@test.local`,
          marketingOptOut: true,
        },
        { networkId, name: 'Saiu (outra)', phone: '11955550000', email: `outro-${RUN}@test.local` },
      ],
    });
    // A junção não depende da ordem das fichas (o banco não garante ordem)
    const same = [
      { email: `rep-${RUN}@test.local`, phone: '11977770001' },
      { email: null, phone: '+5511977770001' },
      { email: `REP-${RUN}@TEST.LOCAL`, phone: '11966660000' },
    ];
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]) {
      const people = (shops as any).uniqueRecipients(
        [],
        order.map((i) => same[i]),
      );
      expect(people).toHaveLength(1);
      expect(people[0].email).toBeTruthy();
      expect(people[0].phone).toBeTruthy();
    }
    // Cliente Fiel + a pessoa repetida (a "Repetida 3" bate no e-mail da 1)
    expect((await shops.previewMarketingSegment(ownerId, shopId, 'ALL')).recipientCount).toBe(2);
    const campaign = await shops.sendMarketingBlast(ownerId, shopId, {
      message: 'Novidade',
      segment: 'ALL',
      sendEmail: true,
      sendWhatsapp: true,
    });
    expect(campaign.recipientCount).toBe(2);
    const emails = queued
      .map((j) => (j as { to?: string }).to)
      .filter((to): to is string => !!to && to.includes('@'));
    expect(emails.filter((e) => e.toLowerCase() === `rep-${RUN}@test.local`)).toHaveLength(1);
    expect(emails).not.toContain(`outro-${RUN}@test.local`);
    const phones = queued
      .map((j) => (j as { to?: string }).to)
      .filter((to): to is string => !!to && to.startsWith('+'));
    expect(phones.filter((p) => p === '+5511977770001')).toHaveLength(1);
    expect(phones).not.toContain('+5511955550000');
  });
});
