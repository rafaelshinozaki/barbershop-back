/**
 * Itens 388–402: fila, e-mail do saldo, foto, sinal, aluguel, campanha,
 * telefone, limite, validade do pacote, moeda da busca, slug antigo e rede.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientAuthService } from '../client-auth/client-auth.service';
import {
  BarbershopService,
  LIST_PAGE_MAX,
  packageExpiresAt,
  pageTake,
  SERVICE_DEPOSIT_MESSAGE,
} from './barbershop.service';
import { SharedLocationService } from './shared-location.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
jest.setTimeout(60_000);
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Fila, saldo, foto, busca e slug (integração)', () => {
  const prisma = new PrismaService();
  const deleted: string[] = [];
  const s3 = {
    createImageUpload: async (key: string) => ({ url: 'https://s3.test', fields: {}, key: `${key}.jpg` }),
    deleteObject: async (key: string) => {
      deleted.push(key);
    },
    getDownloadUrl: async (key: string) => `https://cdn.test/${key}`,
  };
  const emails: Array<{ context?: { message?: string } }> = [];
  const shops = new BarbershopService(
    prisma,
    {} as never,
    s3 as never,
    { isConfigured: () => false } as never,
    {} as never,
    { email: async (payload: { context?: { message?: string } }) => void emails.push(payload) } as never,
    { notify: () => undefined } as never,
  );
  const locations = new SharedLocationService(
    prisma,
    shops,
    { sharedLocationEvent: () => undefined } as never,
    {} as never,
  );
  const clients = new ClientAuthService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  let roleId: number;
  let ownerId: number;
  let memberOwnerId: number;
  let networkId: number;
  let shopId: number;
  let shopBId: number;
  let memberShopId: number;
  let serviceId: number;
  let customerId: number;
  const shopIds: number[] = [];
  const networkIds: number[] = [];
  const userIds: number[] = [];

  const user = async (label: string) => {
    const row = await prisma.user.create({
      data: {
        email: `r388-${label}-${RUN}@test.local`,
        isActive: true,
        password: 'x',
        fullName: `Pessoa ${label}`,
        idDocNumber: `r388${label}${RUN}`.slice(-20),
        phone: `+5511${label}${RUN}`.slice(0, 20),
        gender: 'male',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId,
      },
    });
    userIds.push(row.id);
    return row.id;
  };

  const shop = async (
    label: string,
    owner: number,
    network: number,
    extra: { currency?: string; name?: string } = {},
  ) => {
    const row = await prisma.barbershop.create({
      data: {
        name: extra.name ?? `Unidade ${label}`,
        slug: `r388-${label}-${RUN}`,
        address: 'Rua A, 1',
        city: 'SP',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `r388-${label}-${RUN}@test.local`,
        timezone: 'America/Sao_Paulo',
        currency: extra.currency ?? 'BRL',
        networkId: network,
        ownerUserId: owner,
      },
    });
    shopIds.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await user('dono');
    memberOwnerId = await user('membro');
    networkId = (await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede ${RUN}` } })).id;
    networkIds.push(networkId);
    const memberNetworkId = (
      await prisma.network.create({ data: { ownerUserId: memberOwnerId, name: `Rede membro ${RUN}` } })
    ).id;
    networkIds.push(memberNetworkId);
    shopId = await shop('a', ownerId, networkId);
    shopBId = await shop('b', ownerId, networkId);
    memberShopId = await shop('membro', memberOwnerId, memberNetworkId);
    serviceId = (
      await prisma.barbershopService.create({
        data: {
          barbershopId: shopId,
          name: 'Corte',
          durationMinutes: 30,
          price: new Prisma.Decimal(100),
          depositAmount: new Prisma.Decimal(50),
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          networkId,
          name: 'Cliente Fila',
          phone: `+5511999${RUN}`.slice(0, 20),
          email: `r388-cli-${RUN}@test.local`,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { networkId: { in: networkIds } } });
    await prisma.network.deleteMany({ where: { id: { in: networkIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('caps a list at 200 and rejects a negative limit', () => {
    expect(pageTake(100000, 50)).toBe(LIST_PAGE_MAX);
    expect(() => pageTake(-1, 50)).toThrow(BadRequestException);
    expect(() => pageTake(0, 50)).toThrow(BadRequestException);
  });

  it('expires a package at the end of the last day in the shop timezone', () => {
    const soldAt = new Date('2026-10-29T18:00:00.000Z');
    const expiry = packageExpiresAt(30, 'America/Sao_Paulo', soldAt);
    const evening = new Date('2026-11-28T23:00:00-03:00');
    expect(expiry.getTime()).toBeGreaterThan(evening.getTime());
    expect(expiry.toISOString()).toBe('2026-11-29T02:59:59.999Z');
  });

  it('rejects a price that falls below the current deposit', async () => {
    await expect(
      shops.updateService(ownerId, shopId, serviceId, { price: 30 }),
    ).rejects.toThrow(SERVICE_DEPOSIT_MESSAGE);
    const updated = await shops.updateService(ownerId, shopId, serviceId, { price: 60 });
    expect(Number(updated.price)).toBe(60);
    expect(Number(updated.depositAmount)).toBe(50);
  });

  it('shows the second walk-in as next after the first is called and completed', async () => {
    const first = await shops.createWalkIn(ownerId, shopId, {
      customerName: 'Primeiro',
      customerId,
      services: [{ serviceId }],
    });
    await shops.createWalkIn(ownerId, shopId, {
      customerName: 'Segundo',
      services: [{ serviceId }],
    });
    await shops.updateWalkInStatus(ownerId, shopId, first.id, 'IN_PROGRESS');
    await shops.updateWalkInStatus(ownerId, shopId, first.id, 'COMPLETED');
    const queue = await shops.getWalkIns(ownerId, shopId);
    const active = queue.filter((row) => row.status === 'WAITING' || row.status === 'IN_PROGRESS');
    expect(active[0]?.customerName).toBe('Segundo');
    expect(queue.some((row) => row.customerName === 'Primeiro' && row.status === 'WAITING')).toBe(false);
  });

  it('escapes the shop name in the balance email', async () => {
    await prisma.barbershop.update({
      where: { id: shopId },
      data: { name: '<a href="x">' },
    });
    const pkg = await prisma.servicePackage.create({
      data: {
        barbershopId: shopId,
        serviceId,
        name: 'Pacote',
        totalSessions: 4,
        price: new Prisma.Decimal(100),
      },
    });
    await prisma.clientPackage.create({
      data: {
        barbershopId: shopId,
        customerId,
        servicePackageId: pkg.id,
        totalSessions: 4,
        status: 'ACTIVE',
      },
    });
    await shops.notifyBalancesBeforeDeletion([shopId], []);
    const message = emails.map((mail) => mail.context?.message ?? '').join('\n');
    expect(message).toContain('&lt;a href=&quot;x&quot;&gt;');
    expect(message).not.toContain('<a href="x">');
    await prisma.barbershop.update({ where: { id: shopId }, data: { name: 'Unidade a' } });
  });

  it('does not save a photo until the upload is confirmed, then deletes the old one', async () => {
    await prisma.barbershop.update({
      where: { id: shopId },
      data: { photoKey: `barbershops/${shopId}/old.jpg`, logoHiddenAt: new Date() },
    });
    await shops.prepareBarbershopPhotoUpload(ownerId, shopId, 'image/jpeg');
    const pending = await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } });
    expect(pending.photoKey).toBe(`barbershops/${shopId}/old.jpg`);
    expect(pending.logoHiddenAt).not.toBeNull();
    const upload = await shops.prepareBarbershopPhotoUpload(ownerId, shopId, 'image/jpeg');
    await shops.setBarbershopLogo(ownerId, shopId, upload.key);
    const saved = await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } });
    expect(saved.photoKey).toBe(upload.key);
    expect(saved.photoKey).not.toBe(`barbershops/${shopId}/old.jpg`);
    expect(saved.logoHiddenAt).toBeNull();
    expect(deleted).toContain(`barbershops/${shopId}/old.jpg`);

    const product = await prisma.barbershopProduct.create({
      data: {
        barbershopId: shopId,
        name: 'Pomada',
        salePrice: new Prisma.Decimal(20),
        imageKey: `products/${shopId}/1/old.jpg`,
      },
    });
    await shops.prepareProductPhotoUpload(ownerId, shopId, product.id, 'image/jpeg');
    const pendingProduct = await prisma.barbershopProduct.findUniqueOrThrow({ where: { id: product.id } });
    expect(pendingProduct.imageKey).toBe(`products/${shopId}/1/old.jpg`);
    const productUpload = await shops.prepareProductPhotoUpload(ownerId, shopId, product.id, 'image/jpeg');
    await shops.setProductPhoto(ownerId, shopId, product.id, productUpload.key);
    const savedProduct = await prisma.barbershopProduct.findUniqueOrThrow({ where: { id: product.id } });
    expect(savedProduct.imageKey).toBe(productUpload.key);
    expect(deleted).toContain(`products/${shopId}/1/old.jpg`);
  });

  it('drops a future chair rent when the shared location ends and keeps the overdue one', async () => {
    const link = await prisma.sharedLocationMember.create({
      data: {
        hostBarbershopId: shopId,
        memberBarbershopId: memberShopId,
        status: 'ACTIVE',
        rentStatus: 'ACTIVE',
        rentBillingMode: 'MANUAL',
        rentAmount: new Prisma.Decimal(500),
      },
    });
    const future = new Date(Date.now() + 5 * 86_400_000);
    const overdue = new Date(Date.now() - 2 * 86_400_000);
    await prisma.chairRentPayment.createMany({
      data: [
        {
          sharedLocationMemberId: link.id,
          amount: new Prisma.Decimal(500),
          currency: 'BRL',
          status: 'DUE',
          method: 'PIX',
          dueDate: future,
        },
        {
          sharedLocationMemberId: link.id,
          amount: new Prisma.Decimal(500),
          currency: 'BRL',
          status: 'DUE',
          method: 'PIX',
          dueDate: overdue,
        },
      ],
    });
    await locations.end(ownerId, link.id, shopId);
    const left = await prisma.chairRentPayment.findMany({ where: { sharedLocationMemberId: link.id } });
    expect(left).toHaveLength(1);
    expect(left[0].dueDate?.toISOString()).toBe(overdue.toISOString());
  });

  it('does not mark a network client inactive when they visited another unit recently', async () => {
    const barberA = await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Ana', phone: '11911111111' },
    });
    const barberB = await prisma.barber.create({
      data: { barbershopId: shopBId, name: 'Bia', phone: '11922222222' },
    });
    const serviceB = await prisma.barbershopService.create({
      data: {
        barbershopId: shopBId,
        name: 'Barba',
        durationMinutes: 20,
        price: new Prisma.Decimal(40),
      },
    });
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() - 6);
    await prisma.serviceHistory.createMany({
      data: [
        {
          barbershopId: shopId,
          customerId,
          barberId: barberA.id,
          serviceId,
          performedAt: sixMonths,
          priceCharged: new Prisma.Decimal(60),
        },
        {
          barbershopId: shopBId,
          customerId,
          barberId: barberB.id,
          serviceId: serviceB.id,
          performedAt: new Date(),
          priceCharged: new Prisma.Decimal(40),
        },
      ],
    });
    const recipients = await (shops as any).resolveMarketingSegment(networkId, shopId, 'INACTIVE', 60, true);
    expect(recipients.map((row: { id: number }) => row.id)).not.toContain(customerId);
  });

  it('finds a customer by the digits of the phone, whatever the punctuation', async () => {
    const phone = `+5511988${RUN.slice(-7)}`;
    const digits = phone.replace(/\D/g, '');
    await prisma.customer.create({
      data: { networkId, name: `Fone ${RUN}`, phone },
    });
    const punctuated = `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    const byMask = await shops.getCustomers(ownerId, shopId, { search: punctuated });
    const byTail = await shops.getCustomers(ownerId, shopId, { search: digits.slice(-9) });
    expect(byMask.some((row) => row.phone === phone)).toBe(true);
    expect(byTail.some((row) => row.phone === phone)).toBe(true);
  });

  it('returns at most 200 customers when the screen asks for a million', async () => {
    await prisma.customer.createMany({
      data: Array.from({ length: 201 }, (_, i) => ({
        networkId,
        name: `Lote ${String(i).padStart(3, '0')} ${RUN}`,
        phone: `9${RUN}${i}`.slice(0, 20),
      })),
    });
    const page = await shops.getCustomers(ownerId, shopId, { limit: 100000 });
    expect(page.length).toBeLessThanOrEqual(200);
    expect(page.length).toBe(200);
  });

  it('keeps a price filter inside the searcher currency', async () => {
    const tag = `Moeda ${RUN}`;
    const priced = async (label: string, currency: string, price: number) => {
      const id = await shop(label, ownerId, networkId, { currency, name: `${tag} ${label}` });
      await prisma.barbershopService.create({
        data: {
          barbershopId: id,
          name: 'Corte',
          durationMinutes: 30,
          price: new Prisma.Decimal(price),
          category: 'HAIR',
        },
      });
    };
    await priced('brl', 'BRL', 40);
    await priced('jpy', 'JPY', 3000);
    await priced('eur', 'EUR', 45);
    const found = await shops.searchPublicBarbershops({ query: tag, maxPrice: 50, currency: 'BRL' });
    const names = found.map((row) => row.name);
    expect(names).toContain(`${tag} brl`);
    expect(names).not.toContain(`${tag} jpy`);
    expect(names).not.toContain(`${tag} eur`);
  });

  it('opens the old public address on the current page', async () => {
    const previous = `r388-a-${RUN}`;
    const next = `r388-novo-${RUN}`;
    await shops.changeShopSlug(shopId, next);
    const page = await shops.getPublicBarbershopByslug(previous);
    expect(page.id).toBe(shopId);
    await expect(shops.changeShopSlug(shopBId, previous)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hides a suspended network and answers 404 for a missing favorite', async () => {
    const liveOwner = await user('viva');
    const live = await prisma.network.create({
      data: { ownerUserId: liveOwner, name: `RedeViva ${RUN}` },
    });
    const suspendedOwner = await user('suspenso');
    const suspended = await prisma.network.create({
      data: {
        ownerUserId: suspendedOwner,
        name: `RedeSusp ${RUN}`,
        platformSuspendedAt: new Date(),
      },
    });
    networkIds.push(live.id, suspended.id);
    await shop('viva', liveOwner, live.id);
    await shop('suspensa', suspendedOwner, suspended.id);
    const visible = await clients.searchNetworks(`RedeViva ${RUN}`);
    const hidden = await clients.searchNetworks(`RedeSusp ${RUN}`);
    expect(visible.map((row) => row.id)).toContain(live.id);
    expect(hidden).toHaveLength(0);
    await expect(clients.addFavorite(1, 2_000_000_000)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not repeat a sale when a newer one arrives between pages', async () => {
    const base = new Date('2020-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 3; i++) {
      await prisma.sale.create({
        data: {
          barbershopId: shopId,
          saleType: 'PRODUCT',
          subtotal: new Prisma.Decimal(10),
          total: new Prisma.Decimal(10),
          createdAt: new Date(base + i * 1000),
        },
      });
    }
    const firstPage = await shops.getSales(ownerId, shopId, {
      from: new Date('2020-01-01T00:00:00.000Z'),
      to: new Date('2020-01-02T00:00:00.000Z'),
      limit: 2,
    });
    const newest = await prisma.sale.create({
      data: {
        barbershopId: shopId,
        saleType: 'PRODUCT',
        subtotal: new Prisma.Decimal(10),
        total: new Prisma.Decimal(10),
        createdAt: new Date(base + 10_000),
      },
    });
    const last = firstPage[firstPage.length - 1];
    const nextPage = await shops.getSales(ownerId, shopId, {
      from: new Date('2020-01-01T00:00:00.000Z'),
      to: new Date('2020-01-02T00:00:00.000Z'),
      limit: 2,
      before: { createdAt: last.createdAt, id: last.id },
    });
    const seen = new Set(firstPage.map((row) => row.id));
    expect(nextPage.every((row) => !seen.has(row.id))).toBe(true);
    expect(nextPage.some((row) => row.id === newest.id)).toBe(false);
  });
});
