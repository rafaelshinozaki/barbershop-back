/**
 * sitemap.xml contra o banco de verdade: só as unidades ativas e as buscas
 * que têm resultado, com os mesmos slugs das rotas do front.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { categorySlug, SitemapService, slugifyCity } from './sitemap.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('sitemap.xml (integração)', () => {
  const prisma = new PrismaService();
  let ownerId: number;
  let networkId: number;
  const shopIds: number[] = [];
  const city = `São José ${RUN}`;

  const shop = (label: string, isActive: boolean) =>
    prisma.barbershop.create({
      data: {
        name: `Sitemap ${label}`,
        slug: `sitemap-${label}-${RUN}`,
        address: 'Rua A, 1',
        city,
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `sitemap-${label}-${RUN}@test.local`,
        networkId,
        ownerUserId: ownerId,
        isActive,
        services: {
          create: [
            { name: 'Barba', durationMinutes: 30, price: new Decimal(40), category: 'BEARD' },
          ],
        },
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
          email: `sitemap-owner-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dono Sitemap',
          idDocNumber: `${RUN}map`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Map ${RUN}` } })
    ).id;
    shopIds.push((await shop('ativa', true)).id, (await shop('inativa', false)).id);
  });

  afterAll(async () => {
    await prisma.barbershopService.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('unidades ativas e as buscas por categoria, cidade e categoria × cidade', async () => {
    const before = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.test/';
    try {
      const xml = await new SitemapService(prisma).sitemapXml();
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml).toContain(`<loc>https://app.test/u/sitemap-ativa-${RUN}</loc>`);
      expect(xml).not.toContain(`sitemap-inativa-${RUN}`);
      const citySlug = slugifyCity(city);
      expect(citySlug).toBe(`sao-jose-${RUN}`);
      expect(xml).toContain('<loc>https://app.test/search</loc>');
      expect(xml).toContain(`<loc>https://app.test/search/${categorySlug('BEARD')}</loc>`);
      expect(xml).toContain(`<loc>https://app.test/search/all/${citySlug}</loc>`);
      expect(xml).toContain(`<loc>https://app.test/search/beard/${citySlug}</loc>`);
      expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    } finally {
      if (before === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = before;
    }
  });

  it('fica em cache por uma hora', async () => {
    const sitemap = new SitemapService(prisma);
    const first = await sitemap.sitemapXml(1_000);
    await prisma.barbershop.update({ where: { id: shopIds[1] }, data: { isActive: true } });
    try {
      expect(await sitemap.sitemapXml(1_000 + 60_000)).toBe(first);
      expect(await sitemap.sitemapXml(1_000 + 3_600_001)).toContain(`sitemap-inativa-${RUN}`);
    } finally {
      await prisma.barbershop.update({ where: { id: shopIds[1] }, data: { isActive: false } });
    }
  });
});
