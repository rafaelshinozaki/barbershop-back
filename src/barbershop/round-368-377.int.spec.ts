/**
 * Itens 370 a 372, 374, 376 e 377, contra o Postgres: contagem de estoque,
 * apagar mínimo e local, apagar campo opcional, gerente fora do período,
 * resposta ocultada e o pacote que vence primeiro.
 */
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService, currentManagers } from './barbershop.service';
import { ReviewManagementService } from './review-management.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Itens 370–377 (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const sent: string[] = [];
  const reviews = new ReviewManagementService(prisma, shops, {
    email: async (_job: unknown, id?: string) => {
      if (id) sent.push(id);
    },
  } as never);
  let ownerId: number;
  let networkId: number;
  let shopId: number;
  let expiredManagerId: number;
  let activeManagerId: number;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    const user = (email: string, name: string) =>
      prisma.user.create({
        data: {
          email,
          isActive: true,
          password: 'x',
          fullName: name,
          idDocNumber: email.replace(/\W/g, '').slice(-20),
          phone: '+5511900000000',
          gender: 'other',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      });
    ownerId = (await user(`r368-dona-${RUN}@test.local`, 'Dona')).id;
    expiredManagerId = (await user(`r368-saiu-${RUN}@test.local`, 'Saiu')).id;
    activeManagerId = (await user(`r368-fica-${RUN}@test.local`, 'Fica')).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede 368 ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Unidade 368',
          slug: `r368-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r368-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    const yesterday = new Date(Date.now() - 86_400_000);
    const nextWeek = new Date(Date.now() + 7 * 86_400_000);
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        userId: expiredManagerId,
        staffType: 'manager',
        name: 'Gerente que saiu',
        phone: '11900000001',
        isActive: true,
        accessEndsAt: yesterday,
      },
    });
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        userId: activeManagerId,
        staffType: 'manager',
        name: 'Gerente no período',
        phone: '11900000002',
        isActive: true,
        accessEndsAt: nextWeek,
      },
    });
    jest.spyOn(shops as never, 'ensureModuleAccess').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { barbershopId: shopId } });
    await prisma.clientPackage.deleteMany({ where: { barbershopId: shopId } });
    await prisma.servicePackage.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.inventoryMovement.deleteMany({
      where: { inventoryItem: { barbershopId: shopId } },
    });
    await prisma.inventoryItem.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopProduct.deleteMany({ where: { barbershopId: shopId } });
    await prisma.productCategory.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    const customers = await prisma.customer.findMany({ where: { networkId } });
    await prisma.changeLog.deleteMany({
      where: { entityType: 'Customer', entityId: { in: customers.map((c) => String(c.id)) } },
    });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('370: saldo 15 e contagem 12 geram ajuste de -3, tipo Ajuste, com a data da contagem', async () => {
    const product = await shops.createProduct(ownerId, shopId, { name: 'Pomada 370', salePrice: 20 });
    await shops.adjustInventory(ownerId, shopId, {
      productId: product.id,
      quantityChange: 15,
      movementType: 'PURCHASE',
    });
    const counted = await shops.adjustInventory(ownerId, shopId, {
      productId: product.id,
      countedQuantity: 12,
    });
    expect(Number(counted.quantity)).toBe(12);
    expect(counted.lastCountedAt).toBeInstanceOf(Date);
    expect(counted.movementId).toEqual(expect.any(Number));
    const movement = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id: counted.movementId! },
    });
    expect(Number(movement.quantityChange)).toBe(-3);
    expect(movement.movementType).toBe('ADJUSTMENT');
  });

  it('371: apagar o mínimo e o local grava null', async () => {
    const product = await shops.createProduct(ownerId, shopId, { name: 'Gel 371', salePrice: 15 });
    await shops.updateInventoryItem(ownerId, shopId, product.id, {
      minQuantity: 5,
      location: 'Prateleira',
    });
    const cleared = await shops.updateInventoryItem(ownerId, shopId, product.id, {
      minQuantity: null,
      location: null,
    });
    expect(cleared.minQuantity).toBeNull();
    expect(cleared.location).toBeNull();
  });

  it('372: apagar e-mail e observação da ficha, e os opcionais de produto, serviço e profissional', async () => {
    const customer = await shops.createCustomer(ownerId, shopId, {
      name: 'Ana',
      phone: '11988887001',
      email: `ana-${RUN}@test.local`,
      notes: 'prefere silêncio',
    });
    const updated = await shops.updateCustomer(ownerId, shopId, customer.id, {
      email: null,
      notes: null,
    });
    expect(updated.email).toBeNull();
    expect(updated.notes).toBeNull();

    const category = await shops.createProductCategory(ownerId, shopId, { name: 'Cabelo' });
    const product = await shops.createProduct(ownerId, shopId, {
      name: 'Shampoo 372',
      salePrice: 30,
      categoryId: category.id,
      sku: `SKU-${RUN}`,
      description: '500 ml',
      costPrice: 10,
    });
    const productCleared = await shops.updateProduct(ownerId, shopId, product.id, {
      sku: null,
      description: null,
      categoryId: null,
      costPrice: null,
    });
    expect(productCleared.sku).toBeNull();
    expect(productCleared.description).toBeNull();
    expect(productCleared.categoryId).toBeNull();
    expect(productCleared.costPrice).toBeNull();

    const service = await shops.createService(ownerId, shopId, {
      name: 'Corte 372',
      durationMinutes: 30,
      price: 50,
      category: 'HAIR',
      description: 'máquina e tesoura',
    });
    await prisma.barbershopService.update({
      where: { id: service.id },
      data: { icon: '✂️' },
    });
    const serviceCleared = await shops.updateService(ownerId, shopId, service.id, {
      description: null,
      icon: null,
    });
    expect(serviceCleared.description).toBeNull();
    expect(serviceCleared.icon).toBeNull();

    const barber = await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Bruno',
        phone: '11900007002',
        email: `bruno-${RUN}@test.local`,
        specialization: 'degradê',
        hireDate: new Date('2020-03-01'),
      },
    });
    const barberCleared = await shops.updateBarber(ownerId, shopId, barber.id, {
      email: null,
      specialization: null,
      hireDate: null,
    });
    expect(barberCleared.email).toBeNull();
    expect(barberCleared.specialization).toBeNull();
    expect(barberCleared.hireDate).toBeNull();
  });

  it('374: gerente com acesso até ontem não entra; o que está no período entra', async () => {
    const rows = await prisma.barber.findMany({
      where: { barbershopId: shopId, ...currentManagers() },
      select: { userId: true },
    });
    expect(rows.map((row) => row.userId)).toEqual([activeManagerId]);
  });

  it('376: o mesmo texto continua oculto, e responder de novo não manda outro e-mail', async () => {
    const customer = await shops.createCustomer(ownerId, shopId, {
      name: 'Caio',
      phone: '11988887003',
      email: `caio-${RUN}@test.local`,
    });
    const review = await prisma.review.create({
      data: { barbershopId: shopId, customerId: customer.id, rating: 2, comment: 'demorou' },
    });
    await reviews.reply(ownerId, shopId, review.id, 'desculpa pela demora');
    expect(sent).toEqual([`review-reply-${review.id}`]);
    await prisma.review.update({
      where: { id: review.id },
      data: { replyHiddenAt: new Date('2026-10-01T12:00:00Z') },
    });
    await reviews.reply(ownerId, shopId, review.id, 'desculpa pela demora');
    const hidden = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
    expect(hidden.replyHiddenAt).toEqual(new Date('2026-10-01T12:00:00Z'));
    await reviews.reply(ownerId, shopId, review.id, '');
    await reviews.reply(ownerId, shopId, review.id, 'segunda resposta');
    expect(sent).toEqual([`review-reply-${review.id}`]);
    const again = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
    expect(again.reply).toBe('segunda resposta');
    expect(again.replyHiddenAt).toBeNull();
  });

  it('377: o fechamento enxerga primeiro o pacote que vence em 10 dias', async () => {
    const customer = await shops.createCustomer(ownerId, shopId, {
      name: 'Dora',
      phone: '11988887004',
    });
    const service = await shops.createService(ownerId, shopId, {
      name: 'Barba 377',
      durationMinutes: 20,
      price: 40,
      category: 'BEARD',
    });
    const offer = await prisma.servicePackage.create({
      data: {
        barbershopId: shopId,
        serviceId: service.id,
        name: 'Pacote barba',
        totalSessions: 4,
        price: 120,
      },
    });
    const soon = new Date(Date.now() + 10 * 86_400_000);
    const later = new Date(Date.now() + 180 * 86_400_000);
    await prisma.clientPackage.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        servicePackageId: offer.id,
        totalSessions: 4,
        expiresAt: soon,
        createdAt: new Date(Date.now() - 30 * 86_400_000),
      },
    });
    await prisma.clientPackage.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        servicePackageId: offer.id,
        totalSessions: 4,
        expiresAt: later,
        createdAt: new Date(),
      },
    });
    const list = await shops.getClientPackages(ownerId, shopId, customer.id);
    expect(new Date(list[0].expiresAt!).getTime()).toBe(soon.getTime());
  });
});
