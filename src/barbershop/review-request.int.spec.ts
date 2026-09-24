/**
 * Pedido de avaliação depois do atendimento, contra o Postgres de verdade:
 * quem recebe (uma vez, na hora certa, sem incomodar quem já avaliou, se
 * descadastrou ou recebeu outro há pouco) e a avaliação pelo link, sem conta.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { ReviewRequestService } from './review-request.service';
import { createAppointmentToken, createReviewToken } from './appointment-link';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const HOUR = 3_600_000;

describe('Pedido de avaliação (integração)', () => {
  const prisma = new PrismaService();
  const sent: Array<{ to: string; template: string; context: any; headers?: any }> = [];
  const posted: unknown[][] = [];
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

  const reviewRequests = new ReviewRequestService(
    prisma,
    { email: async (job: any) => void sent.push(job) } as never,
    { reviewPosted: async (...args: unknown[]) => void posted.push(args) } as never,
    barbershops,
  );

  let ownerId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let serviceId: number;
  let n = 0;

  const customer = async (
    data: Partial<{ email: string | null; marketingOptOut: boolean; clientAccountId: number }> = {},
  ) =>
    prisma.customer.create({
      data: {
        networkId,
        name: 'Carlos Cliente Souza',
        phone: `9${RUN.slice(-9)}${++n}`,
        email: data.email === undefined ? `cli-${n}-${RUN}@test.local` : data.email,
        marketingOptOut: data.marketingOptOut ?? false,
        clientAccountId: data.clientAccountId,
      },
    });
  // Atendimento que terminou `hoursAgo` horas atrás
  const appointment = async (customerId: number, hoursAgo: number, status = 'COMPLETED') =>
    prisma.appointment.create({
      data: {
        barbershopId: shopId,
        customerId,
        barberId,
        startAt: new Date(Date.now() - (hoursAgo + 0.5) * HOUR),
        endAt: new Date(Date.now() - hoursAgo * HOUR),
        status,
        services: { create: [{ serviceId, unitPrice: new Decimal(50) }] },
      },
    });
  const sentTo = (email: string | null) => sent.filter((s) => s.to === email);
  // O banco pode ter atendimentos de outros testes: só conta os deste
  const ours = () => sent.filter((s) => s.to.includes(RUN));

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `rev-owner-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dono Avaliação',
          idDocNumber: `${RUN}rev`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Rev ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Estrela',
          slug: `rev-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `rev-${RUN}@test.local`,
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
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
      })
    ).id;
  });

  afterEach(() => {
    sent.length = 0;
    posted.length = 0;
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointmentService.deleteMany({
      where: { appointment: { barbershopId: shopId } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.clientAccount.deleteMany({ where: { email: { contains: `-${RUN}@` } } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('manda uma vez, algumas horas depois do atendimento, com as estrelas e o descadastro', async () => {
    const c = await customer();
    const done = await appointment(c.id, 3);
    const tooSoon = await appointment((await customer()).id, 0.5);
    const tooOld = await appointment((await customer()).id, 24 * 5);

    await reviewRequests.enqueueDueRequests();
    const mine = sentTo(c.email);
    expect(mine).toHaveLength(1);
    expect(mine[0].template).toBe('review_request');
    expect(mine[0].context.CustomerName).toBe('Carlos');
    expect(mine[0].context.Stars).toHaveLength(5);
    expect(mine[0].context.Stars[4].URL).toContain(
      `/review?t=${encodeURIComponent(createReviewToken(done.id))}&r=5`,
    );
    expect(mine[0].context.UnsubscribeURL).toContain('/unsubscribe?t=');
    expect(mine[0].headers['List-Unsubscribe']).toBeTruthy();

    // Cedo demais fica pra depois (sem marcar); antigo demais não recebe
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: tooSoon.id } }))
        .reviewRequestSentAt,
    ).toBeNull();
    expect(ours()).toHaveLength(1);

    // Rodando de novo não repete
    await reviewRequests.enqueueDueRequests();
    expect(ours()).toHaveLength(1);
    void tooOld;
  });

  it('não manda pra quem não tem e-mail, se descadastrou, já avaliou ou recebeu outro há pouco', async () => {
    await appointment((await customer({ email: null })).id, 3);
    const optedOut = await customer({ marketingOptOut: true });
    await appointment(optedOut.id, 3);

    const reviewed = await customer();
    await prisma.review.create({
      data: { barbershopId: shopId, customerId: reviewed.id, rating: 5 },
    });
    await appointment(reviewed.id, 3);

    const regular = await customer();
    const earlier = await appointment(regular.id, 24 * 20);
    await prisma.appointment.update({
      where: { id: earlier.id },
      data: { reviewRequestSentAt: new Date(Date.now() - 20 * 24 * HOUR) },
    });
    await appointment(regular.id, 3);

    // Não concluído não conta
    await appointment((await customer()).id, 3, 'NO_SHOW');

    await reviewRequests.enqueueDueRequests();
    expect(ours()).toHaveLength(0);
  });

  it('avaliar pelo link, sem conta: cria, reenviar atualiza a mesma; aparece na página', async () => {
    const c = await customer();
    const appt = await appointment(c.id, 3);
    const token = createReviewToken(appt.id);

    const page = await reviewRequests.getReviewRequest(token);
    expect(page).toMatchObject({
      barbershopName: 'Barbearia Estrela',
      customerName: 'Carlos',
      barberName: 'Ana',
      serviceNames: 'Corte',
      rating: null,
    });

    await reviewRequests.submitReview(token, 4, '  Ótimo corte  ');
    await reviewRequests.submitReview(token, 5, 'Voltei a pensar: perfeito');
    const reviews = await prisma.review.findMany({
      where: { barbershopId: shopId, customerId: c.id },
    });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ rating: 5, comment: 'Voltei a pensar: perfeito' });
    expect((await reviewRequests.getReviewRequest(token)).rating).toBe(5);
    expect(posted[0]).toEqual([shopId, null, 4, 'Ótimo corte', 'Carlos Cliente Souza']);

    const listed = await barbershops.getBarbershopReviews(shopId);
    expect(listed.find((r) => r.id === reviews[0].id)?.reviewerName).toBe('Carlos S.');
  });

  it('equipe pega o link de um atendimento concluído pra mandar ao cliente (quem é de fora não)', async () => {
    const c = await customer({ email: null });
    const done = await appointment(c.id, 3);
    const pending = await appointment(c.id, 30, 'CONFIRMED');
    const link = await reviewRequests.staffReviewLink(ownerId, shopId, done.id);
    expect(link).toContain(`/review?t=${encodeURIComponent(createReviewToken(done.id))}`);
    await expect(
      reviewRequests.staffReviewLink(ownerId, shopId, pending.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    const outsider = await prisma.user.create({
      data: {
        email: `rev-out-${RUN}@test.local`,
        password: 'x',
        fullName: 'De Fora',
        idDocNumber: `${RUN}out`.slice(-20),
        phone: `+5521${RUN}`.slice(0, 20),
        gender: 'male',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: 'BarbershopOwner' } })).id,
      },
    });
    await expect(reviewRequests.staffReviewLink(outsider.id, shopId, done.id)).rejects.toThrow();
  });

  it('unidade apagar a ficha do cliente não some com a avaliação (fica sem o nome)', async () => {
    const c = await customer();
    const review = await prisma.review.create({
      data: { barbershopId: shopId, customerId: c.id, rating: 1, comment: 'Atrasou 1h' },
    });
    await prisma.customer.delete({ where: { id: c.id } });
    const kept = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
    expect(kept).toMatchObject({ customerId: null, rating: 1 });
    const listed = await barbershops.getBarbershopReviews(shopId);
    expect(listed.find((r) => r.id === review.id)?.reviewerName).toBe('Cliente');
  });

  it('cliente com conta que já avaliou logado: o link muda essa avaliação, não cria outra', async () => {
    const account = await prisma.clientAccount.create({
      data: { email: `conta-${RUN}@test.local`, name: 'Bia Conta', password: null },
    });
    const c = await customer({ clientAccountId: account.id });
    await prisma.review.create({
      data: { barbershopId: shopId, clientAccountId: account.id, rating: 2 },
    });
    const appt = await appointment(c.id, 3);
    await reviewRequests.submitReview(createReviewToken(appt.id), 5);
    const reviews = await prisma.review.findMany({
      where: { barbershopId: shopId, OR: [{ clientAccountId: account.id }, { customerId: c.id }] },
    });
    expect(reviews).toHaveLength(1);
    expect(reviews[0].rating).toBe(5);
  });

  it('link adulterado, de gerenciar ou de atendimento não concluído não serve; nota fora de 1–5 também não', async () => {
    const c = await customer();
    const done = await appointment(c.id, 3);
    const [, sig] = createReviewToken(done.id).split('.');
    const other = await appointment(c.id, 30, 'CONFIRMED');

    await expect(reviewRequests.getReviewRequest(`${other.id}.${sig}`)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      reviewRequests.getReviewRequest(createAppointmentToken(done.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      reviewRequests.submitReview(createReviewToken(other.id), 5),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(reviewRequests.submitReview(createReviewToken(done.id), 6)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      reviewRequests.submitReview(createReviewToken(done.id), 5, 'x'.repeat(1001)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
