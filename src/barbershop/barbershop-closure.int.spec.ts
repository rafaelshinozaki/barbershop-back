/**
 * "Excluir unidade" encerra em vez de apagar (item 128): a equipe perde o
 * acesso, a unidade some das listas e da página pública, e o histórico
 * financeiro continua no banco.
 */
import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Encerrar unidade (integração)', () => {
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
  let ownerId: number;
  let basicId: number;
  let saleId: number;
  let networkId: number;
  let shopId: number;
  let customerId: number;

  const user = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `close-${label}-${RUN}@test.local`,
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

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await user('dona', roleId);
    basicId = await user('basico', roleId);
    networkId = (
      await prisma.network.create({
        data: {
          ownerUserId: ownerId,
          name: `Rede Encerra ${RUN}`,
        },
      })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Encerra',
          slug: `close-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `close-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Ana', phone: '11911111111' },
    });
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Básico',
        phone: '11933333333',
        userId: basicId,
        staffType: 'basic',
      },
    });
    await prisma.barbershopService.create({
      data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(80) },
    });
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Cliente Encerra', phone: `5${RUN.slice(-10)}` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('encerra: some das listas e do acesso, libera o slug e guarda as vendas', async () => {
    saleId = (
      await prisma.sale.create({
        data: {
          barbershopId: shopId,
          customerId,
          saleType: 'SERVICE',
          subtotal: new Decimal(80),
          total: new Decimal(80),
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          paidAt: new Date(),
        },
      })
    ).id;
    const entry = await prisma.waitlistEntry.create({
      data: { barbershopId: shopId, customerId, date: new Date(Date.now() + 3 * 86_400_000) },
    });
    expect((await shops.getMyBarbershops(basicId)).map((s) => s.id)).toContain(shopId);
    // Pacote com 1 de 4 sessões usada, vendido por 120: faltam 90 pra devolver
    const svc = await prisma.barbershopService.findFirstOrThrow({
      where: { barbershopId: shopId },
    });
    const offer = await prisma.servicePackage.create({
      data: {
        barbershopId: shopId,
        serviceId: svc.id,
        name: 'Pacote 4',
        totalSessions: 4,
        price: new Decimal(120),
      },
    });
    const pkg = await prisma.clientPackage.create({
      data: {
        barbershopId: shopId,
        customerId,
        servicePackageId: offer.id,
        totalSessions: 4,
        usedSessions: 1,
      },
    });
    await prisma.barbershop.update({
      where: { id: shopId },
      data: { featuredUntil: new Date(Date.now() + 10 * 86_400_000) },
    });
    expect(await shops.getBarbershopDeletionPreview(ownerId, shopId)).toMatchObject({
      activePackages: 1,
      packageRefunds: [{ currency: 'BRL', amount: 90 }],
    });

    await shops.deleteBarbershop(ownerId, shopId);
    expect((await prisma.clientPackage.findUniqueOrThrow({ where: { id: pkg.id } })).status).toBe(
      'CANCELLED',
    );

    const closed = await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.featuredUntil).toBeNull();
    expect(closed.isActive).toBe(false);
    expect(closed.slug).not.toBe(`close-${RUN}`);
    // O histórico financeiro continua lá
    expect(await prisma.sale.count({ where: { id: saleId } })).toBe(1);
    // Ninguém mais entra nem vê a unidade
    expect((await shops.getMyBarbershops(ownerId)).map((s) => s.id)).not.toContain(shopId);
    expect((await shops.getMyBarbershops(basicId)).map((s) => s.id)).not.toContain(shopId);
    expect(await shops.getMyAccessLevel(ownerId, shopId)).toBeNull();
    await expect(shops.getBarbershop(ownerId, shopId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(shops.getPublicBarbershopByslug(`close-${RUN}`)).rejects.toBeTruthy();
    expect(
      (await prisma.barber.findMany({ where: { barbershopId: shopId } })).every((b) => !b.isActive),
    ).toBe(true);
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe(
      'CANCELLED',
    );
    // O slug fica livre pra outra unidade
    const again = await prisma.barbershop.create({
      data: {
        name: 'Nova no mesmo endereço',
        slug: `close-${RUN}`,
        address: 'Rua A, 1',
        city: 'SP',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `close-nova-${RUN}@test.local`,
        timezone: 'America/Sao_Paulo',
        networkId,
        ownerUserId: ownerId,
      },
    });
    await prisma.barbershop.delete({ where: { id: again.id } });
  });
});
