/**
 * Itens 366 e 367, contra o Postgres de verdade: importar a mesma planilha de
 * novo não repete as faltas, e a perda lançada à mão que derruba o estoque
 * abaixo do mínimo avisa como a venda. O item 365 (lista de espera) está em
 * waitlist-online.int.spec.ts.
 */
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { ImportService } from './import.service';
import { ActivityNotificationsService } from '../notifications/activity-notifications.service';
import { addDaysStr, toZonedParts } from '../common/timezone.util';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TZ = 'America/Sao_Paulo';

describe('Itens 366 e 367 (integração)', () => {
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
  const imports = new ImportService(prisma, shops);
  const activity = new ActivityNotificationsService(prisma, stub, stub, stub);
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
          email: `r365-dona-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Dona',
          idDocNumber: `r365${RUN}`.slice(-20),
          phone: '+5511900000000',
          gender: 'other',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede 365 ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Unidade 365',
          slug: `r365-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r365-${RUN}@test.local`,
          timezone: TZ,
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    await prisma.barber.create({
      data: { barbershopId: shopId, staffType: 'barber', name: 'Carla', phone: '11900000001' },
    });
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.inventoryItem.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopProduct.deleteMany({ where: { barbershopId: shopId } });
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

  it('366: a mesma planilha importada de novo não repete a falta nem o atendimento', async () => {
    const today = toZonedParts(new Date(), TZ).dateStr;
    const br = (d: string) => d.split('-').reverse().join('/');
    const csv = [
      'Cliente;Telefone;Servico;Duracao;Valor;Data;Hora;Status',
      `Davi;11977771001;Corte;30;50,00;${br(addDaysStr(today, -2))};10:00;Faltou`,
      `Eva;11977771002;Corte;30;50,00;${br(addDaysStr(today, -2))};11:00;Atendido`,
    ].join('\n');
    const first = await imports.apply(ownerId, shopId, csv);
    expect(first.errors).toEqual([]);
    expect(first.appointmentsCreated).toBe(2);

    const preview = await imports.preview(ownerId, shopId, csv);
    expect(preview.appointmentsCreated).toBe(0);
    expect(preview.appointmentsSkipped).toBe(2);
    expect(preview.errors.every((e) => e.includes('já importado'))).toBe(true);

    const again = await imports.apply(ownerId, shopId, csv);
    expect(again.appointmentsCreated).toBe(0);
    expect(again.appointmentsSkipped).toBe(2);
    const rows = await prisma.appointment.findMany({ where: { barbershopId: shopId } });
    expect(rows.map((r) => r.status).sort()).toEqual(['COMPLETED', 'NO_SHOW']);
  });

  it('367: perda que cruza o mínimo avisa uma vez; a seguinte, com o saldo já baixo, não', async () => {
    jest.spyOn(shops as never, 'ensureModuleAccess').mockResolvedValue(undefined as never);
    const delivered: string[] = [];
    jest.spyOn(activity as never, 'deliver').mockImplementation((async (
      _shop: number,
      _cat: string,
      opts: { key: string },
    ) => {
      delivered.push(opts.key);
    }) as never);
    const product = await shops.createProduct(ownerId, shopId, { name: 'Pomada', salePrice: 30 });
    await shops.updateInventoryItem(ownerId, shopId, product.id, { minQuantity: 5 });
    await shops.adjustInventory(ownerId, shopId, {
      productId: product.id,
      quantityChange: 8,
      movementType: 'PURCHASE',
    });
    const loss = await shops.adjustInventory(ownerId, shopId, {
      productId: product.id,
      quantityChange: -4,
      movementType: 'LOSS',
    });
    await activity.stockAdjusted(loss.movementId, shopId);
    expect(delivered).toEqual([`low-stock:${loss.id}:m${loss.movementId}`]);

    const again = await shops.adjustInventory(ownerId, shopId, {
      productId: product.id,
      quantityChange: -1,
      movementType: 'LOSS',
    });
    await activity.stockAdjusted(again.movementId, shopId);
    expect(delivered).toHaveLength(1);
  });
});
