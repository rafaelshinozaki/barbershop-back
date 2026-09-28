import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { CareerService } from './career.service';
import { ModerationService } from './moderation.service';
import { ProfessionalReviewService } from './professional-review.service';

const RUN = `${Date.now()}`.slice(-9);

/**
 * Moderação: qualquer visitante denuncia (sem duplicar pela mesma pessoa),
 * o admin vê a fila agrupada e oculta, descarta ou restaura. Ocultar tira
 * a foto da galeria, o perfil do ar e a unidade da busca (o link direto da
 * unidade continua).
 */
describe('Moderação de conteúdo público (integração)', () => {
  const prisma = new PrismaService();
  const s3 = { getDownloadUrl: async (key: string) => `https://cdn.test/${key}` } as never;
  const pushed: number[][] = [];
  const moderation = new ModerationService(prisma, s3, {
    sendToUsers: async (ids: number[]) => void pushed.push(ids),
  } as never);
  const titles = async (userId: number) =>
    (await prisma.userNotification.findMany({ where: { userId } })).map((n) => n.title);
  const stub = {} as never;
  const shops = new BarbershopService(
    prisma,
    stub,
    s3,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const career = new CareerService(prisma, new ProfessionalReviewService(prisma));

  let roleId: number;
  let ownerId: number;
  let adminId: number;
  let networkId: number;
  let shopId: number;
  let photoId: number;
  let professionalId: number;
  let reviewId: number;
  const slug = `mod-${RUN}`;
  const proSlug = `mod-pro-${RUN}`;
  const ipA = '203.0.113.10';
  const ipB = '203.0.113.20';

  const user = (label: string) =>
    prisma.user.create({
      data: {
        email: `mod-${label}-${RUN}@test.local`,
        password: 'x',
        fullName: `Moderação ${label}`,
        idDocNumber: `${RUN}${label}`.slice(-20),
        phone: `+55117${RUN}${label.length}`.slice(0, 20),
        gender: 'female',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId,
      },
    });

  const item = async (type: string, id: number) =>
    (await moderation.queue()).find((i) => i.targetType === type && i.targetId === id);

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (await user('dona')).id;
    adminId = (await user('admin')).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Mod ${RUN}` } })
    ).id;
    const shop = await prisma.barbershop.create({
      data: {
        name: `Unidade Mod ${RUN}`,
        slug,
        address: 'Rua A, 1',
        city: `Cidade Mod ${RUN}`,
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `mod-${RUN}@test.local`,
        networkId,
        ownerUserId: ownerId,
      },
    });
    shopId = shop.id;
    photoId = (
      await prisma.barbershopPhoto.create({
        data: { barbershopId: shopId, key: `gallery/${RUN}.jpg`, caption: 'Corte' },
      })
    ).id;
    professionalId = (
      await prisma.professional.create({
        data: { userId: ownerId, slug: proSlug, visibility: 'public', isPublic: true },
      })
    ).id;
    const barber = await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Dona',
        phone: '11966666666',
        userId: ownerId,
        professionalId,
      },
    });
    const customer = await prisma.customer.create({
      data: { networkId, name: 'Cliente Mod Silva', phone: `6${RUN}` },
    });
    const appt = await prisma.appointment.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        barberId: barber.id,
        startAt: new Date(Date.now() - 3 * 3_600_000),
        endAt: new Date(Date.now() - 2 * 3_600_000),
        status: 'COMPLETED',
      },
    });
    reviewId = (
      await prisma.professionalReview.create({
        data: {
          appointmentId: appt.id,
          barberId: barber.id,
          barbershopId: shopId,
          professionalId,
          customerId: customer.id,
          rating: 1,
          comment: 'Texto ofensivo',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.contentReport.deleteMany({
      where: {
        OR: [
          { targetType: 'photo', targetId: photoId },
          { targetType: 'professional_review', targetId: reviewId },
          { targetType: 'professional_profile', targetId: professionalId },
          { targetType: 'barbershop', targetId: shopId },
        ],
      },
    });
    await prisma.barbershop.delete({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.delete({ where: { id: networkId } });
    await prisma.professional.delete({ where: { id: professionalId } });
    await prisma.userNotification.deleteMany({ where: { userId: { in: [ownerId, adminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
    await prisma.$disconnect();
  });

  it('denúncia validada; a mesma pessoa não duplica, outra soma', async () => {
    await expect(
      moderation.report({ targetType: 'photo', targetId: photoId, reason: 'xyz' }, ipA),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      moderation.report({ targetType: 'user', targetId: 1, reason: 'spam' }, ipA),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      moderation.report({ targetType: 'photo', targetId: 999_999_999, reason: 'spam' }, ipA),
    ).rejects.toBeInstanceOf(NotFoundException);

    const photo = { targetType: 'photo', targetId: photoId };
    await moderation.report({ ...photo, reason: 'inappropriate_image', details: 'Nudez' }, ipA);
    await moderation.report({ ...photo, reason: 'inappropriate_image' }, ipA);
    await moderation.report({ ...photo, reason: 'spam' }, ipB);

    const queued = await item('photo', photoId);
    expect(queued).toMatchObject({
      title: `Unidade Mod ${RUN}`,
      text: 'Corte',
      imageUrl: `https://cdn.test/gallery/${RUN}.jpg`,
      link: `/u/${slug}`,
      hidden: false,
      openReports: 2,
      details: ['Nudez'],
    });
    expect(queued!.reasons).toEqual(
      expect.arrayContaining([
        { reason: 'inappropriate_image', count: 1 },
        { reason: 'spam', count: 1 },
      ]),
    );
  });

  it('ocultar a foto tira da galeria pública; restaurar volta', async () => {
    const photos = async () =>
      (await shops.getPublicBarbershopByslug(slug)).portfolio.map((p) => p.photoId);
    expect(await photos()).toContain(photoId);

    await moderation.resolve(adminId, 'photo', photoId, 'hide');
    expect(await photos()).not.toContain(photoId);
    // O dono é avisado no sininho e no celular
    expect(await titles(ownerId)).toContain('Foto ocultada pela moderação');
    expect(pushed.some((ids) => ids.includes(ownerId))).toBe(true);
    expect(await item('photo', photoId)).toMatchObject({ hidden: true, openReports: 0 });
    // Oculta não recebe denúncia nova
    await expect(
      moderation.report({ targetType: 'photo', targetId: photoId, reason: 'spam' }, ipA),
    ).rejects.toBeInstanceOf(NotFoundException);

    await moderation.resolve(adminId, 'photo', photoId, 'restore');
    expect(await photos()).toContain(photoId);
    expect(await titles(ownerId)).toContain('Foto de volta na galeria');
    // Sem denúncia em aberto e no ar: sai da fila
    expect(await item('photo', photoId)).toBeUndefined();
  });

  it('descartar mantém no ar e tira da fila', async () => {
    await moderation.report(
      { targetType: 'professional_review', targetId: reviewId, reason: 'offensive' },
      ipA,
    );
    expect(await item('professional_review', reviewId)).toMatchObject({
      text: 'Texto ofensivo',
      link: `/p/${proSlug}`,
      openReports: 1,
    });
    const before = (await titles(ownerId)).length;
    await moderation.resolve(adminId, 'professional_review', reviewId, 'dismiss');
    // Descartar não avisa ninguém
    expect(await titles(ownerId)).toHaveLength(before);
    expect(await item('professional_review', reviewId)).toBeUndefined();
    expect((await career.publicProfile(proSlug)).reviews.map((r) => r.id)).toContain(reviewId);
  });

  it('suspender o perfil: some a página e a busca; restaurar volta', async () => {
    await moderation.report(
      { targetType: 'professional_profile', targetId: professionalId, reason: 'impersonation' },
      ipB,
    );
    await moderation.resolve(adminId, 'professional_profile', professionalId, 'hide');
    await expect(career.publicProfile(proSlug)).rejects.toBeInstanceOf(NotFoundException);
    expect(await titles(ownerId)).toContain('Perfil público suspenso');
    const found = await shops.searchPublicProfessionals({ city: `Cidade Mod ${RUN}` });
    expect(found.map((p) => p.slug)).not.toContain(proSlug);

    await moderation.resolve(adminId, 'professional_profile', professionalId, 'restore');
    expect((await career.publicProfile(proSlug)).id).toBe(professionalId);
  });

  it('unidade fora da vitrine: some da busca, o link direto continua', async () => {
    await moderation.report({ targetType: 'barbershop', targetId: shopId, reason: 'fake' }, ipA);
    await moderation.resolve(adminId, 'barbershop', shopId, 'hide');
    expect(await titles(ownerId)).toContain('Unidade fora da busca');
    const search = await shops.searchPublicBarbershops({ city: `Cidade Mod ${RUN}` });
    expect(search).toHaveLength(0);
    expect((await shops.getPublicBarbershopByslug(slug)).id).toBe(shopId);

    await moderation.resolve(adminId, 'barbershop', shopId, 'restore');
    expect(await shops.searchPublicBarbershops({ city: `Cidade Mod ${RUN}` })).toHaveLength(1);
    await expect(
      moderation.resolve(adminId, 'barbershop', shopId, 'delete'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
