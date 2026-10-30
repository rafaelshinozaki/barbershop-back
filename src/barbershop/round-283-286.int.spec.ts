/**
 * Itens 283 a 286, contra o Postgres de verdade: a ficha apagada sai do
 * histórico, a importação da agenda solo não escapa da cota, a venda com
 * pontos resgatados não troca de cliente (e tirar pontos não deixa saldo
 * negativo), e o preço de custo é só do gerente para cima.
 */
import { PrismaService } from '../prisma/prisma.service';
import {
  BarbershopService,
  REMOVED_CUSTOMER_NAME,
  SALE_CUSTOMER_LOCKED_MESSAGE,
} from './barbershop.service';
import { allowModulesInTests } from './barbershop-plan.constants';
import { ImportService } from './import.service';
import { addDaysStr, toZonedParts } from '../common/timezone.util';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TZ = 'America/Sao_Paulo';

describe('Itens 283 a 286 (integração)', () => {
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
  const imports = new ImportService(prisma, shops);
  let ownerId: number;
  let managerId: number;
  let barberUserId: number;
  let networkId: number;
  let shopId: number;
  let soloOwnerId: number;
  let soloNetworkId: number;
  let soloShopId: number;

  const user = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `r283-${label}-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: `Teste ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'other',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;

  const shop = (label: string, owner: number, network: number, extra: object = {}) =>
    prisma.barbershop.create({
      data: {
        name: `Unidade ${label}`,
        slug: `r283-${label}-${RUN}`,
        address: 'Rua A, 1',
        city: 'SP',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `r283-${label}-${RUN}@test.local`,
        timezone: TZ,
        networkId: network,
        ownerUserId: owner,
        ...extra,
      },
    });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await user('dona', roleId);
    managerId = await user('gerente', roleId);
    barberUserId = await user('barbeiro', roleId);
    soloOwnerId = await user('solo', roleId);
    networkId = (
      await prisma.network.create({
        data: {
          ownerUserId: ownerId,
          name: `Rede 283 ${RUN}`,
          loyaltyEnabled: true,
          loyaltyPointsPerCurrencyUnit: 1,
          loyaltyPointValue: 1,
        },
      })
    ).id;
    shopId = (await shop('rede', ownerId, networkId)).id;
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        userId: managerId,
        staffType: 'manager',
        name: 'Gerente',
        phone: '11900000001',
      },
    });
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        userId: barberUserId,
        staffType: 'barber',
        name: 'Barbeiro',
        phone: '11900000002',
      },
    });
    soloNetworkId = (
      await prisma.network.create({ data: { ownerUserId: soloOwnerId, name: `Solo ${RUN}` } })
    ).id;
    soloShopId = (
      await shop('solo', soloOwnerId, soloNetworkId, {
        practiceKind: 'solo',
        // A agenda existe há 3 dias
        createdAt: new Date(Date.now() - 3 * 86_400_000),
      })
    ).id;
    await prisma.barber.create({
      data: {
        barbershopId: soloShopId,
        userId: soloOwnerId,
        staffType: 'barber',
        name: 'Solo',
        phone: '11900000003',
      },
    });
  });

  afterAll(async () => {
    for (const id of [shopId, soloShopId]) {
      await prisma.appointment.deleteMany({ where: { barbershopId: id } });
      await prisma.sale.deleteMany({ where: { barbershopId: id } });
      await prisma.barbershopProduct.deleteMany({ where: { barbershopId: id } });
      await prisma.barbershop.deleteMany({ where: { id } });
    }
    for (const id of [networkId, soloNetworkId]) {
      const customers = await prisma.customer.findMany({ where: { networkId: id } });
      await prisma.changeLog.deleteMany({
        where: { entityType: 'Customer', entityId: { in: customers.map((c) => String(c.id)) } },
      });
      await prisma.customer.deleteMany({ where: { networkId: id } });
      await prisma.network.deleteMany({ where: { id } });
    }
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('283: apagar a ficha tira o nome, o telefone e o e-mail do histórico dela', async () => {
    const customer = await prisma.customer.create({
      data: {
        networkId,
        name: `Joana Apagada ${RUN}`,
        phone: '11955551111',
        email: `joana-${RUN}@test.local`,
      },
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: { name: `Joana Renomeada ${RUN}` },
    });
    await shops.deleteCustomer(ownerId, shopId, customer.id);

    const rows = await prisma.changeLog.findMany({
      where: { entityType: 'Customer', entityId: String(customer.id) },
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('Joana');
    expect(text).not.toContain('joana-');
    expect(text).not.toContain('5551111');
    expect(rows.every((r) => r.entityName === REMOVED_CUSTOMER_NAME)).toBe(true);
  });

  it('284: agenda solo — atendimento passado depois da criação conta na cota; antes, é histórico', async () => {
    const today = toZonedParts(new Date(), TZ).dateStr;
    const br = (d: string) => d.split('-').reverse().join('/');
    const csv = [
      'Cliente;Telefone;Servico;Duracao;Valor;Data;Hora;Status',
      `Ana;11977770001;Corte;30;50,00;${br(addDaysStr(today, -1))};10:00;Atendido`,
      `Bia;11977770002;Corte;30;50,00;${br(addDaysStr(today, -10))};10:00;Atendido`,
    ].join('\n');
    const result = await imports.apply(soloOwnerId, soloShopId, csv);
    expect(result.errors).toEqual([]);
    expect(result.appointmentsCreated).toBe(2);
    const rows = await prisma.appointment.findMany({
      where: { barbershopId: soloShopId },
      orderBy: { startAt: 'asc' },
    });
    expect(rows.map((r) => r.source)).toEqual(['HISTORY', 'IMPORT']);
  });

  it('285: venda com pontos resgatados não troca de cliente; tirar pontos não deixa saldo negativo', async () => {
    const a = await prisma.customer.create({
      data: { networkId, name: 'Cliente A', phone: '11955552001', loyaltyPoints: 100 },
    });
    const b = await prisma.customer.create({
      data: { networkId, name: 'Cliente B', phone: '11955552002' },
    });
    const sale = (customerId: number, payload: object = {}) =>
      shops.createSale(ownerId, shopId, {
        customerId,
        saleType: 'SERVICE',
        items: [{ itemType: 'SERVICE', quantity: 1, unitPrice: 50, totalPrice: 50 }],
        subtotal: 50,
        total: 50,
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        ...payload,
      });

    const redeemed = await sale(a.id, { loyaltyPointsRedeemed: 10 });
    await expect(
      shops.updateSale(ownerId, shopId, redeemed!.id, { customerId: b.id }),
    ).rejects.toThrow(SALE_CUSTOMER_LOCKED_MESSAGE);
    const points = async (id: number) =>
      (await prisma.customer.findUniqueOrThrow({ where: { id } })).loyaltyPoints;
    expect(await points(b.id)).toBe(0);

    // Venda que deu pontos a B: B gasta tudo; apagar a venda não deixa negativo
    const earned = await sale(b.id);
    expect(await points(b.id)).toBeGreaterThan(0);
    await prisma.customer.update({ where: { id: b.id }, data: { loyaltyPoints: 0 } });
    await shops.deleteSale(ownerId, shopId, earned!.id);
    expect(await points(b.id)).toBe(0);
  });

  it('286: o preço de custo só aparece para gerente e dono', async () => {
    await shops.createProduct(ownerId, shopId, { name: 'Pomada', salePrice: 40, costPrice: 15 });
    const cost = async (userId: number) =>
      (await shops.getProducts(userId, shopId)).find((p) => p.name === 'Pomada')?.costPrice;
    expect(Number(await cost(ownerId))).toBe(15);
    expect(Number(await cost(managerId))).toBe(15);
    expect(await cost(barberUserId)).toBeNull();
  });
});
