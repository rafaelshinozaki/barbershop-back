/**
 * Pausar a unidade (item 181): só o dono, e a cobrança do clube fica
 * suspensa na Stripe até reativar.
 */
import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Pausar a unidade (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const updates: Array<{ id: string; pause: unknown }> = [];
  const stripe = {
    updateSubscription: async (id: string, data: { pause_collection?: unknown }) => {
      if (id.includes('falha')) throw new Error('Stripe fora do ar');
      updates.push({ id, pause: data.pause_collection });
      return {};
    },
  };
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stripe as never,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  let ownerId: number;
  let managerId: number;
  let networkId: number;
  let shopId: number;

  const user = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `pause-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Pessoa ${label}`,
          idDocNumber: `${label}${RUN}`.slice(-20),
          phone: `+5511${RUN}${label.length}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
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
    managerId = await user('gerente', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Pausa',
          slug: `pause-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `pause-shop-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        userId: managerId,
        name: 'Gerente',
        phone: '11988887777',
        staffType: 'manager',
      },
    });
    const service = await prisma.barbershopService.create({
      data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
    });
    const plan = await prisma.clientSubscriptionPlan.create({
      data: { barbershopId: shopId, serviceId: service.id, name: 'Clube', price: new Decimal(100) },
    });
    for (const [label, status] of [
      ['ativa', 'ACTIVE'],
      ['atraso', 'PAST_DUE'],
      ['cancelada', 'CANCELED'],
    ] as const) {
      const client = await prisma.clientAccount.create({
        data: { email: `pause-${label}-cli-${RUN}@test.local`, name: `Cliente ${label}` },
      });
      await prisma.clientSubscription.create({
        data: {
          barbershopId: shopId,
          clientAccountId: client.id,
          planId: plan.id,
          stripeSubscriptionId: `sub_${label}_${RUN}`,
          status,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "ClientAccount" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('o gerente edita a unidade, mas não pausa', async () => {
    await shops.updateBarbershop(managerId, shopId, { description: 'Nova descrição' });
    await expect(
      shops.updateBarbershop(managerId, shopId, { isActive: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Mandar o mesmo valor não é pausar
    await shops.updateBarbershop(managerId, shopId, { isActive: true });
    expect(updates).toHaveLength(0);
  });

  it('o dono pausa: a cobrança do clube fica suspensa; reativar volta só essas', async () => {
    await shops.updateBarbershop(ownerId, shopId, { isActive: false });
    expect(updates.map((u) => u.id).sort()).toEqual([`sub_ativa_${RUN}`, `sub_atraso_${RUN}`]);
    expect(updates.every((u) => (u.pause as { behavior: string }).behavior === 'void')).toBe(true);
    const paused = await prisma.clientSubscription.findMany({
      where: { barbershopId: shopId, shopPausedAt: { not: null } },
    });
    expect(paused).toHaveLength(2);

    updates.length = 0;
    await shops.updateBarbershop(ownerId, shopId, { isActive: true });
    expect(updates.map((u) => u.id).sort()).toEqual([`sub_ativa_${RUN}`, `sub_atraso_${RUN}`]);
    expect(updates.every((u) => u.pause === '')).toBe(true);
    expect(
      await prisma.clientSubscription.count({
        where: { barbershopId: shopId, shopPausedAt: { not: null } },
      }),
    ).toBe(0);
  });

  it('moeda e fuso: válidos, moeda só pelo dono e não com dinheiro registrado (item 184)', async () => {
    await expect(shops.updateBarbershop(ownerId, shopId, { currency: 'R$' })).rejects.toThrow(
      'Moeda inválida',
    );
    await expect(shops.updateBarbershop(ownerId, shopId, { timezone: 'Narnia' })).rejects.toThrow(
      'Fuso horário inválido',
    );
    await expect(
      shops.updateBarbershop(managerId, shopId, { currency: 'USD' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Esta unidade tem clube: a moeda não muda
    await expect(shops.updateBarbershop(ownerId, shopId, { currency: 'usd' })).rejects.toThrow(
      'dinheiro registrado',
    );
    // Mesma moeda (só formato diferente) passa
    await shops.updateBarbershop(ownerId, shopId, { currency: ' brl ' });
    // País novo: o fuso acompanha; a moeda fica (já tem dinheiro)
    const moved = await shops.updateBarbershop(ownerId, shopId, { country: 'PT', state: '' });
    expect(moved).toMatchObject({ currency: 'BRL', timezone: 'Europe/Lisbon' });

    // Unidade sem dinheiro registrado: o país novo traz a moeda dele
    const fresh = await prisma.barbershop.create({
      data: {
        name: 'Nova',
        slug: `pause-nova-${RUN}`,
        address: 'Rua B, 2',
        city: 'SP',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999998',
        email: `pause-nova-${RUN}@test.local`,
        timezone: 'America/Sao_Paulo',
        networkId,
        ownerUserId: ownerId,
      },
    });
    try {
      expect(
        await shops.updateBarbershop(ownerId, fresh.id, { country: 'PT', state: '' }),
      ).toMatchObject({ country: 'PT', currency: 'EUR', timezone: 'Europe/Lisbon' });
      expect(await shops.updateBarbershop(ownerId, fresh.id, { currency: 'USD' })).toMatchObject({
        currency: 'USD',
      });
    } finally {
      await prisma.barbershop.delete({ where: { id: fresh.id } });
    }
  });
});
