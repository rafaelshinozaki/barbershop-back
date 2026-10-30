/**
 * Valores do catálogo (item 196): duração, preço e sinal do serviço, preço
 * do produto e ajuste de estoque, contra o Postgres de verdade.
 */
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { allowModulesInTests } from './barbershop-plan.constants';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Valores do catálogo (integração)', () => {
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
  allowModulesInTests(shops, ['products']);
  let ownerId: number;
  let networkId: number;
  let shopId: number;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `cat-dona-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Dona',
          idDocNumber: `cat${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Catálogo',
          slug: `cat-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `cat-shop-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  const service = (over: Record<string, unknown> = {}) =>
    shops.createService(ownerId, shopId, {
      name: 'Corte',
      durationMinutes: 30,
      price: 50,
      category: 'HAIR',
      ...over,
    } as never);

  it('serviço: duração de 1 min a 12 h, preço sem negativo, sinal até o preço', async () => {
    for (const durationMinutes of [0, -30, 721, 12.5]) {
      await expect(service({ durationMinutes })).rejects.toThrow('duração do serviço');
    }
    await expect(service({ price: -10 })).rejects.toThrow('Preço do serviço inválido');
    await expect(service({ depositAmount: 80 })).rejects.toThrow('maior que o preço');
    const ok = await service({ depositAmount: 20 });
    // Baixar o preço para menos que o sinal também não passa
    await expect(shops.updateService(ownerId, shopId, ok.id, { price: 10 })).rejects.toThrow(
      'maior que o preço',
    );
    await expect(
      shops.updateService(ownerId, shopId, ok.id, { durationMinutes: 0 }),
    ).rejects.toThrow('duração do serviço');
    const updated = await shops.updateService(ownerId, shopId, ok.id, {
      price: 30,
      depositAmount: null,
    });
    expect(Number(updated.price)).toBe(30);
    expect(updated.depositAmount).toBeNull();
  });

  it('produto: preço e custo sem negativo; custo zero fica zero', async () => {
    await expect(
      shops.createProduct(ownerId, shopId, { name: 'Pomada', salePrice: -1 }),
    ).rejects.toThrow('Preço de venda inválido');
    await expect(
      shops.createProduct(ownerId, shopId, { name: 'Pomada', salePrice: 30, costPrice: -5 }),
    ).rejects.toThrow('Custo inválido');
    const product = await shops.createProduct(ownerId, shopId, {
      name: 'Pomada',
      salePrice: 30,
      costPrice: 0,
    });
    expect(Number(product.costPrice)).toBe(0);
    await expect(
      shops.updateProduct(ownerId, shopId, product.id, { salePrice: -3 }),
    ).rejects.toThrow('Preço de venda inválido');
  });

  it('estoque: tipo de movimento da lista, quantidade diferente de zero, mínimo sem negativo', async () => {
    jest.spyOn(shops as any, 'ensureModuleAccess').mockResolvedValue(undefined);
    const product = await shops.createProduct(ownerId, shopId, { name: 'Gel', salePrice: 20 });
    await expect(
      shops.adjustInventory(ownerId, shopId, {
        productId: product.id,
        quantityChange: 5,
        movementType: 'SALE',
      }),
    ).rejects.toThrow('Tipo de movimentação');
    await expect(
      shops.adjustInventory(ownerId, shopId, { productId: product.id, quantityChange: 0 }),
    ).rejects.toThrow('diferente de zero');
    await expect(
      shops.updateInventoryItem(ownerId, shopId, product.id, { minQuantity: -1 }),
    ).rejects.toThrow('estoque mínimo');
    const item = await shops.adjustInventory(ownerId, shopId, {
      productId: product.id,
      quantityChange: 5,
      movementType: 'PURCHASE',
    });
    expect(Number(item!.quantity)).toBe(5);
  });
});
