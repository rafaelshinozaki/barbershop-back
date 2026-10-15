/**
 * Serviço, produto e categoria de outra rede não podem ser alterados (item 154).
 */
import { NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Escopo de serviço, produto e categoria (integração)', () => {
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

  let ownerA: number;
  let shopA: number;
  let shopB: number;
  let networkA: number;
  let networkB: number;
  let serviceB: number;
  let productB: number;
  let categoryB: number;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    const user = async (label: string) =>
      (
        await prisma.user.create({
          data: {
            email: `scope-${label}-${RUN}@test.local`,
            password: 'x',
            fullName: `Teste ${label}`,
            idDocNumber: `${RUN}${label}`.slice(-20),
            phone: `+5511${RUN}${label}`.slice(0, 20),
            gender: 'male',
            birthdate: new Date('1990-01-01'),
            readTerms: true,
            roleId,
          },
        })
      ).id;
    ownerA = await user('a');
    const ownerB = await user('b');
    networkA = (await prisma.network.create({ data: { ownerUserId: ownerA, name: `A ${RUN}` } })).id;
    networkB = (await prisma.network.create({ data: { ownerUserId: ownerB, name: `B ${RUN}` } })).id;
    const shop = (owner: number, network: number, label: string) =>
      prisma.barbershop.create({
        data: {
          name: label,
          slug: `scope-${label}-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `scope-${label}-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId: network,
          ownerUserId: owner,
        },
      });
    shopA = (await shop(ownerA, networkA, 'a')).id;
    shopB = (await shop(ownerB, networkB, 'b')).id;
    serviceB = (
      await prisma.barbershopService.create({
        data: {
          barbershopId: shopB,
          name: 'Corte B',
          durationMinutes: 30,
          price: new Decimal(40),
        },
      })
    ).id;
    categoryB = (
      await prisma.productCategory.create({ data: { barbershopId: shopB, name: 'Cat B' } })
    ).id;
    productB = (
      await prisma.barbershopProduct.create({
        data: { barbershopId: shopB, name: 'Gel B', salePrice: new Decimal(10), categoryId: categoryB },
      })
    ).id;
  });

  afterAll(async () => {
    const ids = [shopA, shopB].filter((id) => id != null);
    if (ids.length) await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
    const networks = [networkA, networkB].filter((id) => id != null);
    if (networks.length) await prisma.network.deleteMany({ where: { id: { in: networks } } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  const denied = async (run: Promise<unknown>) => {
    await expect(run).rejects.toBeInstanceOf(NotFoundException);
  };

  it('não altera nem apaga o catálogo de outra rede', async () => {
    await denied(shops.updateService(ownerA, shopA, serviceB, { name: 'Invadido', price: 1 }));
    await denied(shops.deleteService(ownerA, shopA, serviceB));
    await denied(shops.updateProduct(ownerA, shopA, productB, { name: 'Invadido', salePrice: 1 }));
    await denied(shops.deleteProduct(ownerA, shopA, productB));
    await denied(shops.updateProductCategory(ownerA, shopA, categoryB, { name: 'Invadido' }));
    await denied(shops.deleteProductCategory(ownerA, shopA, categoryB));
    await denied(
      shops.createProduct(ownerA, shopA, { name: 'Novo', salePrice: 5, categoryId: categoryB }),
    );
    const own = await shops.createProduct(ownerA, shopA, { name: 'Próprio', salePrice: 5 });
    await denied(shops.updateProduct(ownerA, shopA, own.id, { categoryId: categoryB }));

    const service = await prisma.barbershopService.findUniqueOrThrow({ where: { id: serviceB } });
    const product = await prisma.barbershopProduct.findUniqueOrThrow({ where: { id: productB } });
    const category = await prisma.productCategory.findUniqueOrThrow({ where: { id: categoryB } });
    expect(service.name).toBe('Corte B');
    expect(product.name).toBe('Gel B');
    expect(category.name).toBe('Cat B');
    expect(service.barbershopId).toBe(shopB);
  });
});
