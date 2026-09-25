/**
 * Avaliações do lado da unidade e da moderação, contra o Postgres de
 * verdade: resposta pública, denúncia e ocultar (sai da página e da nota).
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { ReviewManagementService } from './review-management.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Responder, denunciar e moderar avaliações (integração)', () => {
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
  const emails: any[] = [];
  const reviews = new ReviewManagementService(prisma, barbershops, {
    email: async (job: any) => void emails.push(job),
  } as never);

  let ownerId: number;
  let staffUserId: number;
  let networkId: number;
  let shopId: number;
  let otherShopId: number;
  let good: number;
  let bad: number;
  let elsewhere: number;

  const createUser = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `rvm-${label}-${RUN}@test.local`,
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
  const shop = async (label: string) =>
    (
      await prisma.barbershop.create({
        data: {
          name: `Avaliada ${label}`,
          slug: `rvm-${label}-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `rvm-${label}-${RUN}@test.local`,
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
  const review = async (barbershopId: number, rating: number, comment: string) => {
    const customer = await prisma.customer.create({
      data: {
        networkId,
        name: 'Maria Cliente',
        phone: `7${RUN.slice(-9)}${rating}${barbershopId}`,
      },
    });
    return (
      await prisma.review.create({
        data: { barbershopId, customerId: customer.id, rating, comment },
      })
    ).id;
  };

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner', roleId);
    staffUserId = await createUser('staff', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Rvm ${RUN}` } })
    ).id;
    shopId = await shop('a');
    otherShopId = await shop('b');
    await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Ana', phone: '11911111111', userId: staffUserId },
    });
    good = await review(shopId, 5, 'Excelente');
    bad = await review(shopId, 1, 'Texto ofensivo');
    elsewhere = await review(otherShopId, 4, 'Bom');
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { barbershopId: { in: [shopId, otherShopId] } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: { in: [shopId, otherShopId] } } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('dono responde: aparece na página; editar troca, vazio apaga', async () => {
    await reviews.reply(ownerId, shopId, good, '  Obrigado, volte sempre!  ');
    let listed = await barbershops.getBarbershopReviews(shopId);
    expect(listed.find((r) => r.id === good)).toMatchObject({
      reply: 'Obrigado, volte sempre!',
      repliedAt: expect.any(String),
    });
    await reviews.reply(ownerId, shopId, good, '');
    listed = await barbershops.getBarbershopReviews(shopId);
    expect(listed.find((r) => r.id === good)?.reply).toBeNull();

    await expect(reviews.reply(ownerId, shopId, good, 'x'.repeat(1001))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Avaliação de outra unidade não se responde por esta
    await expect(reviews.reply(ownerId, shopId, elsewhere, 'oi')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('primeira resposta avisa o cliente por e-mail (editar não reenvia; descadastrado não recebe)', async () => {
    const withEmail = await prisma.customer.create({
      data: {
        networkId,
        name: 'Rui Email',
        phone: `6${RUN.slice(-9)}1`,
        email: `rui-${RUN}@test.local`,
      },
    });
    const optedOut = await prisma.customer.create({
      data: {
        networkId,
        name: 'Lia Sem',
        phone: `6${RUN.slice(-9)}2`,
        email: `lia-${RUN}@test.local`,
        marketingOptOut: true,
      },
    });
    const r1 = (
      await prisma.review.create({
        data: { barbershopId: shopId, customerId: withEmail.id, rating: 4, comment: 'Gostei' },
      })
    ).id;
    const r2 = (
      await prisma.review.create({
        data: { barbershopId: shopId, customerId: optedOut.id, rating: 5 },
      })
    ).id;
    emails.length = 0;

    await reviews.reply(ownerId, shopId, r1, 'Valeu, Rui!');
    await reviews.reply(ownerId, shopId, r1, 'Valeu mesmo, Rui!');
    await reviews.reply(ownerId, shopId, r2, 'Obrigado!');
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      template: 'review_reply',
      to: `rui-${RUN}@test.local`,
      context: expect.objectContaining({ CustomerName: 'Rui', Reply: 'Valeu, Rui!', Rating: 4 }),
    });
    expect(emails[0].context.PageURL).toContain(`/u/rvm-a-${RUN}`);
    expect(emails[0].headers['List-Unsubscribe']).toBeTruthy();
    // Não mexe na nota média dos próximos testes
    await prisma.review.deleteMany({ where: { id: { in: [r1, r2] } } });
  });

  it('profissional não vê o painel, não responde nem denuncia', async () => {
    await expect(reviews.listForShop(staffUserId, shopId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(reviews.reply(staffUserId, shopId, good, 'oi')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(reviews.report(staffUserId, shopId, bad, 'x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('denúncia vai pra moderação; ocultar tira da página e da nota; manter encerra a denúncia', async () => {
    await expect(reviews.report(ownerId, shopId, bad, '  ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await reviews.report(ownerId, shopId, bad, 'Ofende a equipe');
    const queue = await reviews.listForModeration();
    expect(queue.find((r) => r.id === bad)).toMatchObject({
      reportReason: 'Ofende a equipe',
      hidden: false,
      barbershopName: 'Avaliada a',
    });
    expect((await barbershops.getReviewSummary(shopId)).averageRating).toBe(3);

    await reviews.moderate(bad, true);
    expect((await barbershops.getBarbershopReviews(shopId)).map((r) => r.id)).not.toContain(bad);
    expect(await barbershops.getReviewSummary(shopId)).toEqual({
      averageRating: 5,
      reviewCount: 1,
    });
    expect((await reviews.listForShop(ownerId, shopId)).find((r) => r.id === bad)?.hidden).toBe(
      true,
    );
    await expect(reviews.report(ownerId, shopId, bad, 'de novo')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // Voltou atrás: aparece de novo e a denúncia fica encerrada
    await reviews.moderate(bad, false);
    expect((await barbershops.getBarbershopReviews(shopId)).map((r) => r.id)).toContain(bad);
    expect((await reviews.listForModeration()).find((r) => r.id === bad)).toBeUndefined();
  });
});
