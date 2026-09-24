/**
 * Exclusão da própria conta (LGPD) contra o Postgres de verdade, com Stripe
 * e S3 simulados.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AccountDeletionService } from './account-deletion.service';
import { BarbershopService } from './barbershop.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'Senha#Forte1';

describe('Exclusão de conta do dono/funcionário (integração com o banco)', () => {
  const prisma = new PrismaService();
  const stripeCalls: string[] = [];
  const stripe = {
    cancelSubscription: async (id: string) => {
      stripeCalls.push(`cancel:${id}`);
    },
    deleteCustomer: async (id: string) => {
      stripeCalls.push(`delete:${id}`);
    },
  };
  const s3Deleted: string[] = [];
  const s3 = { deleteObject: async (key: string) => void s3Deleted.push(key) };
  const stub = {} as never;
  const barbershopService = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stripe as never,
    stub,
    { notify: () => undefined } as never,
  );
  const service = new AccountDeletionService(
    prisma,
    stripe as never,
    s3 as never,
    barbershopService,
  );

  let ownerRoleId: number;
  let adminRoleId: number;
  const created = { users: [] as number[], networks: [] as number[], clients: [] as number[] };

  async function createUser(label: string, roleId: number) {
    const user = await prisma.user.create({
      data: {
        email: `del-${label}-${RUN}@test.local`,
        password: await bcrypt.hash(PASSWORD, 4),
        fullName: `Pessoa ${label}`,
        idDocNumber: `${label}${RUN}`.slice(-20),
        phone: `+5511${RUN}`.slice(0, 20),
        gender: 'male',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        isActive: true,
        roleId,
        stripeCustomerId: `cus_${label}_${RUN}`,
        photoKey: `users/${label}-${RUN}.jpg`,
      },
    });
    created.users.push(user.id);
    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'Linux',
        ip: '203.0.113.9',
        location: 'São Paulo',
      },
    });
    await prisma.activeSession.create({
      data: {
        userId: user.id,
        sessionToken: `sess-${label}-${RUN}`,
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'Linux',
        ip: '203.0.113.9',
        location: 'São Paulo',
      },
    });
    return user;
  }

  async function createBusiness(ownerId: number, label: string) {
    const network = await prisma.network.create({
      data: { ownerUserId: ownerId, name: `Rede ${label} ${RUN}` },
    });
    created.networks.push(network.id);
    const shop = await prisma.barbershop.create({
      data: {
        name: `Unidade ${label} ${RUN}`,
        slug: `del-${label}-${RUN}`,
        address: 'Rua Teste, 1',
        city: 'São Paulo',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `unidade-${label}-${RUN}@test.local`,
        networkId: network.id,
        ownerUserId: ownerId,
      },
    });
    const customer = await prisma.customer.create({
      data: { networkId: network.id, name: 'Cliente da unidade', phone: `11${RUN}` },
    });
    await prisma.sale.create({
      data: {
        barbershopId: shop.id,
        customerId: customer.id,
        saleType: 'SERVICE',
        subtotal: 50,
        total: 50,
        paymentStatus: 'PAID',
      },
    });
    return { network, shop, customer };
  }

  beforeAll(async () => {
    ownerRoleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    adminRoleId = (
      (await prisma.role.findFirst({ where: { name: 'SystemAdmin' } })) ??
      (await prisma.role.create({ data: { name: 'SystemAdmin' } }))
    ).id;
  });

  afterAll(async () => {
    const plans = await prisma.plan.findMany({
      where: { name: { contains: RUN } },
      withDeleted: true,
    } as never);
    const subs = await prisma.subscription.findMany({ where: { userId: { in: created.users } } });
    await prisma.payment.deleteMany({ where: { subscriptionId: { in: subs.map((s) => s.id) } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.$executeRaw`DELETE FROM "Plan" WHERE id = ANY(${(plans as { id: number }[]).map(
      (p) => p.id,
    )})`;
    await prisma.clientSubscription.deleteMany({
      where: { clientAccountId: { in: created.clients } },
    });
    await prisma.clientAccount.deleteMany({ where: { id: { in: created.clients } } });
    await prisma.network.deleteMany({ where: { id: { in: created.networks } } });
    await prisma.loginHistory.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.activeSession.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ANY(${created.users})`;
    await prisma.$disconnect();
  });

  it('dono: senha errada não apaga nada; certa apaga o negócio, cancela cobranças e anonimiza', async () => {
    const owner = await createUser('dono', ownerRoleId);
    const { network, shop, customer } = await createBusiness(owner.id, 'dono');

    // Cliente final com assinatura de serviço na unidade
    const client = await prisma.clientAccount.create({
      data: { email: `cli-${RUN}@test.local`, name: 'Cliente', password: null },
    });
    created.clients.push(client.id);
    const service_ = await prisma.barbershopService.create({
      data: { barbershopId: shop.id, name: 'Corte', durationMinutes: 30, price: 50 },
    });
    const clientPlan = await prisma.clientSubscriptionPlan.create({
      data: { barbershopId: shop.id, serviceId: service_.id, name: 'Mensal', price: 100 },
    });
    await prisma.clientSubscription.create({
      data: {
        barbershopId: shop.id,
        clientAccountId: client.id,
        planId: clientPlan.id,
        stripeSubscriptionId: `sub_cli_${RUN}`,
        status: 'ACTIVE',
      },
    });

    // Plano do dono ativo, com um pagamento (registro fiscal)
    const plan = await prisma.plan.create({
      data: { name: `Plano ${RUN}`, price: new Prisma.Decimal(99), billingCycle: 'MONTHLY' },
    });
    const sub = await prisma.subscription.create({
      data: {
        userId: owner.id,
        planId: plan.id,
        startSubDate: new Date(),
        status: 'ACTIVE',
        stripeSubscriptionId: `sub_dono_${RUN}`,
      } as never,
    });
    await prisma.payment.create({
      data: {
        subscriptionId: sub.id,
        amount: 99,
        paymentDate: new Date(),
        nextPaymentDate: new Date(),
        status: 'SUCCEEDED',
      },
    });

    const preview = await service.preview(owner.id);
    expect(preview).toEqual({
      barbershops: [shop.name],
      activeClientSubscriptions: 1,
      requiresPassword: true,
      blocked: false,
    });

    await expect(service.deleteAccount(owner.id, { password: 'errada' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await prisma.barbershop.findUnique({ where: { id: shop.id } })).toBeTruthy();
    expect(stripeCalls).toEqual([]);

    await service.deleteAccount(owner.id, { password: PASSWORD });

    // Cobranças encerradas no Stripe (cliente da unidade e plano do dono) e
    // cliente do dono apagado lá; foto apagada
    expect(stripeCalls).toEqual(
      expect.arrayContaining([
        `cancel:sub_cli_${RUN}`,
        `cancel:sub_dono_${RUN}`,
        `delete:cus_dono_${RUN}`,
      ]),
    );
    expect(s3Deleted).toContain(`users/dono-${RUN}.jpg`);

    // Negócio apagado
    expect(await prisma.network.findUnique({ where: { id: network.id } })).toBeNull();
    expect(await prisma.barbershop.findUnique({ where: { id: shop.id } })).toBeNull();
    expect(await prisma.customer.findUnique({ where: { id: customer.id } })).toBeNull();

    // Plano: cobrança encerrada, pagamento guardado
    const subAfter = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(subAfter!.status).toBe('INACTIVE');
    expect(await prisma.payment.count({ where: { subscriptionId: sub.id } })).toBe(1);

    // Usuário anônimo, fora do login, e-mail liberado
    expect(await prisma.user.findUnique({ where: { id: owner.id } })).toBeNull();
    const [raw] = await prisma.$queryRaw<
      {
        email: string;
        fullName: string;
        phone: string;
        idDocNumber: string;
        photoKey: string | null;
      }[]
    >`SELECT email, "fullName", phone, "idDocNumber", "photoKey" FROM "User" WHERE id = ${owner.id}`;
    expect(raw).toEqual({
      email: `excluido-${owner.id}@conta-excluida.invalid`,
      fullName: 'Conta excluída',
      phone: '',
      idDocNumber: '',
      photoKey: null,
    });
    expect(await prisma.loginHistory.count({ where: { userId: owner.id } })).toBe(0);
    expect(await prisma.activeSession.count({ where: { userId: owner.id } })).toBe(0);
    const again = await createUser('dono2', ownerRoleId);
    await expect(
      prisma.user.update({ where: { id: again.id }, data: { email: owner.email } }),
    ).resolves.toBeTruthy();
  });

  it('funcionário: o perfil de barbeiro fica na empresa, desligado da conta', async () => {
    const boss = await createUser('chefe', ownerRoleId);
    const { shop } = await createBusiness(boss.id, 'chefe');
    const staff = await createUser('barbeiro', ownerRoleId);
    const barber = await prisma.barber.create({
      data: { barbershopId: shop.id, name: 'Barbeiro', phone: '11988887777', userId: staff.id },
    });

    expect((await service.preview(staff.id)).barbershops).toEqual([]);
    await service.deleteAccount(staff.id, { password: PASSWORD });

    const barberAfter = await prisma.barber.findUnique({ where: { id: barber.id } });
    expect(barberAfter).toBeTruthy();
    expect(barberAfter!.userId).toBeNull();
    // A empresa do chefe continua
    expect(await prisma.barbershop.findUnique({ where: { id: shop.id } })).toBeTruthy();
  });

  it('login social confirma digitando o e-mail; admin do sistema não se exclui', async () => {
    const social = await createUser('social', ownerRoleId);
    await prisma.user.update({ where: { id: social.id }, data: { provider: 'google' } });
    expect((await service.preview(social.id)).requiresPassword).toBe(false);
    await expect(service.deleteAccount(social.id, { email: 'outro@x.com' })).rejects.toThrow();
    await service.deleteAccount(social.id, { email: social.email.toUpperCase() });
    expect(await prisma.user.findUnique({ where: { id: social.id } })).toBeNull();

    const admin = await createUser('admin', adminRoleId);
    expect((await service.preview(admin.id)).blocked).toBe(true);
    await expect(service.deleteAccount(admin.id, { password: PASSWORD })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
