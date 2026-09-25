/**
 * Fotos da página pública (galeria, capa, foto do profissional), contra o
 * Postgres de verdade e com o S3 simulado.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { BarbershopMediaService, MAX_GALLERY_PHOTOS } from './media.service';
import { BarberAvatarResolver } from '../graphql/resolvers/media.resolver';
import { ShopSeoService } from '../seo/shop-seo.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Fotos da página pública (integração, S3 simulado)', () => {
  const prisma = new PrismaService();
  const deleted: string[] = [];
  const s3 = {
    createImageUpload: async (key: string) => ({
      url: 'https://s3',
      fields: [],
      key: `${key}.jpg`,
    }),
    getDownloadUrl: async (key: string) => `https://s3.test/${key}`,
    deleteObject: async (key: string) => void deleted.push(key),
  };
  const stub = {} as never;
  const barbershops = new BarbershopService(
    prisma,
    stub,
    s3 as never,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const media = new BarbershopMediaService(prisma, s3 as never, barbershops);
  const settle = () => new Promise((r) => setTimeout(r, 30));

  let ownerId: number;
  let barberUserId: number;
  let networkId: number;
  let shopId: number;
  let otherShopId: number;
  let barberId: number;
  let colleagueId: number;

  const createUser = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `media-${label}-${RUN}@test.local`,
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
  const shop = (slug: string) =>
    prisma.barbershop.create({
      data: {
        name: `Barbearia ${slug}`,
        slug: `${slug}-${RUN}`,
        address: 'Rua A, 1',
        city: 'SP',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `${slug}-${RUN}@test.local`,
        networkId,
        ownerUserId: ownerId,
      },
    });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner', roleId);
    barberUserId = await createUser('barber', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Media ${RUN}` } })
    ).id;
    shopId = (await shop('media')).id;
    otherShopId = (await shop('media-outra')).id;
    barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Ana', phone: '11911111111', userId: barberUserId },
      })
    ).id;
    colleagueId = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Beto', phone: '11922222222' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barber.deleteMany({ where: { barbershopId: { in: [shopId, otherShopId] } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: [shopId, otherShopId] } } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('galeria: envia, confirma só chave da própria unidade, ordena e apaga', async () => {
    const up = await media.galleryUpload(ownerId, shopId, 'image/jpeg');
    expect(up.key).toMatch(new RegExp(`^barbershops/${shopId}/gallery/`));
    const a = await media.addPhoto(ownerId, shopId, up.key, '  Degradê  ');
    expect(a).toMatchObject({ caption: 'Degradê', position: 0, url: `https://s3.test/${up.key}` });
    const b = await media.addPhoto(
      ownerId,
      shopId,
      (
        await media.galleryUpload(ownerId, shopId)
      ).key,
    );

    // Chave de outra unidade (ou inventada) não entra
    const other = await media.galleryUpload(ownerId, otherShopId);
    await expect(media.addPhoto(ownerId, shopId, other.key)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      media.addPhoto(ownerId, shopId, `barbershops/${shopId}/gallery/../../x.jpg`),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Barbeiro não mexe na galeria
    await expect(media.galleryUpload(barberUserId, shopId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect((await media.reorderPhotos(ownerId, shopId, [b.id, a.id])).map((p) => p.id)).toEqual([
      b.id,
      a.id,
    ]);
    const pub = await barbershops.getPublicBarbershopByslug(`media-${RUN}`);
    expect(pub.portfolio.map((p: { url: string }) => p.url)).toEqual([
      `https://s3.test/${
        (await prisma.barbershopPhoto.findUniqueOrThrow({ where: { id: b.id } })).key
      }`,
      a.url,
    ]);

    await media.removePhoto(ownerId, shopId, a.id);
    await settle();
    expect(deleted).toContain(up.key);
    expect((await media.listPhotos(ownerId, shopId)).map((p) => p.id)).toEqual([b.id]);
  });

  it(`galeria tem limite de ${MAX_GALLERY_PHOTOS} fotos`, async () => {
    const existing = await prisma.barbershopPhoto.count({ where: { barbershopId: shopId } });
    await prisma.barbershopPhoto.createMany({
      data: Array.from({ length: MAX_GALLERY_PHOTOS - existing }, (_, i) => ({
        barbershopId: shopId,
        key: `barbershops/${shopId}/gallery/fill-${i}.jpg`,
        position: 10 + i,
      })),
    });
    await expect(media.galleryUpload(ownerId, shopId)).rejects.toThrow('no máximo');
    await prisma.barbershopPhoto.deleteMany({ where: { barbershopId: shopId } });
  });

  it('capa: troca apaga a anterior; tirar volta pra sem capa', async () => {
    const first = await media.coverUpload(ownerId, shopId, 'image/png');
    expect(await media.setCover(ownerId, shopId, first.key)).toBe(`https://s3.test/${first.key}`);
    const second = await media.coverUpload(ownerId, shopId);
    await media.setCover(ownerId, shopId, second.key);
    await settle();
    expect(deleted).toContain(first.key);
    expect((await barbershops.getPublicBarbershopByslug(`media-${RUN}`)).coverUrl).toBe(
      `https://s3.test/${second.key}`,
    );
    await expect(
      media.setCover(ownerId, shopId, 'barbershops/999/cover-x.jpg'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await media.setCover(ownerId, shopId, null)).toBeNull();
    expect((await barbershops.getPublicBarbershopByslug(`media-${RUN}`)).coverUrl).toBeNull();
  });

  it('foto do profissional: ele mesmo ou o dono; aparece no lugar do link antigo', async () => {
    await prisma.barber.update({
      where: { id: barberId },
      data: { avatarUrl: 'https://antigo/foto.png' },
    });
    const up = await media.avatarUpload(barberUserId, barberId, 'image/webp');
    expect(up.key).toMatch(new RegExp(`^barbershops/${shopId}/barbers/${barberId}/avatar-`));
    await media.setAvatar(barberUserId, barberId, up.key);
    // A barbeira não troca a foto do colega
    await expect(media.avatarUpload(barberUserId, colleagueId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Chave de outro profissional não entra
    await expect(media.setAvatar(ownerId, colleagueId, up.key)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const resolver = new BarberAvatarResolver(s3 as never);
    const saved = await prisma.barber.findUniqueOrThrow({ where: { id: barberId } });
    expect(await resolver.avatarUrl(saved)).toBe(`https://s3.test/${up.key}`);

    await media.setAvatar(ownerId, barberId, null);
    await settle();
    expect(deleted).toContain(up.key);
    const cleared = await prisma.barber.findUniqueOrThrow({ where: { id: barberId } });
    expect(await resolver.avatarUrl(cleared)).toBeNull();
  });

  it('SEO da página: título, descrição, imagem estável e JSON-LD (HairSalon)', async () => {
    const before = { front: process.env.FRONTEND_URL, api: process.env.PUBLIC_API_URL };
    process.env.FRONTEND_URL = 'https://app.test';
    process.env.PUBLIC_API_URL = 'https://api.test';
    try {
      await prisma.barbershop.update({
        where: { id: shopId },
        data: {
          description: 'Corte clássico e barba na navalha.',
          instagramUrl: 'https://instagram.com/media',
          latitude: -23.5,
          longitude: -46.6,
        },
      });
      await media.setCover(ownerId, shopId, (await media.coverUpload(ownerId, shopId)).key);
      const seo = await new ShopSeoService(barbershops).forSlug(`media-${RUN}`);
      expect(seo).toMatchObject({
        title: 'Barbearia media · SP - SP | Agende online',
        description: 'Corte clássico e barba na navalha.',
        url: `https://app.test/u/media-${RUN}`,
        image: `https://api.test/seo/shops/media-${RUN}/image`,
      });
      expect(seo.jsonLd).toMatchObject({
        '@type': 'HairSalon',
        name: 'Barbearia media',
        telephone: '11999999999',
        address: { '@type': 'PostalAddress', addressLocality: 'SP', postalCode: '01000000' },
        geo: { latitude: -23.5, longitude: -46.6 },
        sameAs: ['https://instagram.com/media'],
      });
      expect((seo.jsonLd.openingHoursSpecification as unknown[]).length).toBe(6);
      expect(await new ShopSeoService(barbershops).imageUrl(`media-${RUN}`)).toMatch(/cover-/);
      await expect(new ShopSeoService(barbershops).forSlug('nao-existe')).rejects.toThrow(
        'Unidade não encontrada',
      );
    } finally {
      process.env.FRONTEND_URL = before.front;
      process.env.PUBLIC_API_URL = before.api;
      if (before.front === undefined) delete process.env.FRONTEND_URL;
      if (before.api === undefined) delete process.env.PUBLIC_API_URL;
    }
  });
});
