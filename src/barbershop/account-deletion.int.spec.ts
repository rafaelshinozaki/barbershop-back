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
import { SitemapService } from '../seo/sitemap.service';

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
    createRefund: async (intentId: string, amount?: number) => {
      stripeCalls.push(`refund:${intentId}:${amount ?? 'all'}`);
      return { id: `re_${intentId}` };
    },
  };
  const emails: any[] = [];
  const s3Deleted: string[] = [];
  const s3 = {
    deleteObject: async (key: string) => void s3Deleted.push(key),
    // Todas as fotos da conta (item 340): registra o prefixo apagado
    deletePrefix: async (prefix: string) => (s3Deleted.push(prefix), 0),
  };
  const stub = {} as never;
  const barbershopService = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stripe as never,
    {
      email: async (job: unknown) => void emails.push(job),
      whatsapp: async () => undefined,
    } as never,
    { notify: () => undefined } as never,
  );
  const service = new AccountDeletionService(
    prisma,
    stripe as never,
    s3 as never,
    barbershopService,
    { forgetUser: async () => undefined } as never,
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
      futureAppointments: 0,
      onlineRefunds: [],
      clubRefunds: [],
      activePackages: 0,
      packageRefunds: [],
      overdueChairRents: [],
      giftCards: 0,
      giftCardBalances: [],
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
    expect(s3Deleted).toContain(`users/${owner.id}/`);

    // Unidade encerrada, histórico fica. A rede também fica.
    expect(await prisma.network.findUnique({ where: { id: network.id } })).toBeTruthy();
    const closed = await prisma.barbershop.findUnique({ where: { id: shop.id } });
    expect(closed?.isActive).toBe(false);
    expect(closed?.closedAt).toBeTruthy();
    expect(await prisma.customer.findUnique({ where: { id: customer.id } })).toBeTruthy();
    expect(await prisma.sale.count({ where: { barbershopId: shop.id } })).toBe(1);

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

  it('horários futuros: cancelados, o pago pelo app volta e o cliente é avisado antes de apagar', async () => {
    const owner = await createUser('agenda', ownerRoleId);
    const { shop, customer } = await createBusiness(owner.id, 'agenda');
    await prisma.customer.update({
      where: { id: customer.id },
      data: { email: `cli-agenda-${RUN}@test.local` },
    });
    const barber = await prisma.barber.create({
      data: { barbershopId: shop.id, name: 'Profissional', phone: `12${RUN}`.slice(0, 14) },
    });
    const service_ = await prisma.barbershopService.create({
      data: { barbershopId: shop.id, name: 'Corte', durationMinutes: 30, price: 80 },
    });
    const start = new Date(Date.now() + 3 * 86_400_000);
    const appt = await prisma.appointment.create({
      data: {
        barbershopId: shop.id,
        customerId: customer.id,
        barberId: barber.id,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60_000),
        status: 'CONFIRMED',
        depositPaid: true,
        depositPaidAt: new Date(),
        depositAmount: 20,
        depositPaymentIntentId: `pi_dep_${RUN}`,
        prepaidAt: new Date(),
        prepaidAmount: 60,
        prepaidPaymentIntentId: `pi_pre_${RUN}`,
        services: { create: [{ serviceId: service_.id, quantity: 1, unitPrice: 80 }] },
      },
    });
    // Horário que já passou não entra
    await prisma.appointment.create({
      data: {
        barbershopId: shop.id,
        customerId: customer.id,
        barberId: barber.id,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() - 86_400_000 + 30 * 60_000),
        status: 'COMPLETED',
      },
    });

    const preview = await service.preview(owner.id);
    expect(preview).toMatchObject({
      futureAppointments: 1,
      onlineRefunds: [{ currency: 'BRL', amount: 80 }],
    });

    // O link de gerenciar do e-mail é assinado (no CI não há .env)
    process.env.APPOINTMENT_LINK_SECRET ??= 'segredo-de-teste';
    stripeCalls.length = 0;
    emails.length = 0;
    await service.deleteAccount(owner.id, { password: PASSWORD });

    expect(stripeCalls).toEqual(
      expect.arrayContaining([`refund:pi_dep_${RUN}:all`, `refund:pi_pre_${RUN}:6000`]),
    );
    const cancelled = emails.find((e) => e.template === 'appointment_cancelled');
    expect(cancelled.to).toBe(`cli-agenda-${RUN}@test.local`);
    expect(cancelled.context.Reason).toMatch(/devolvido/);
    expect(cancelled.attachments[0].contentType).toContain('method=CANCEL');
    expect(cancelled.attachments[0].content).toContain(`UID:appointment-${appt.id}@barbershop`);
    expect((await prisma.appointment.findUnique({ where: { id: appt.id } }))?.status).toBe(
      'CANCELLED',
    );
  });

  it('pacotes e cartões-presente com saldo aparecem na prévia e o cliente é avisado (item 220)', async () => {
    const owner = await createUser('saldos', ownerRoleId);
    const { network, shop, customer } = await createBusiness(owner.id, 'saldos');
    await prisma.customer.update({
      where: { id: customer.id },
      data: { email: `cli-pacote-${RUN}@test.local` },
    });
    const svc = await prisma.barbershopService.create({
      data: { barbershopId: shop.id, name: 'Corte', durationMinutes: 30, price: 50 },
    });
    const offer = await prisma.servicePackage.create({
      data: {
        barbershopId: shop.id,
        serviceId: svc.id,
        name: '4 cortes',
        totalSessions: 4,
        price: 160,
      },
    });
    await prisma.clientPackage.create({
      data: {
        barbershopId: shop.id,
        customerId: customer.id,
        servicePackageId: offer.id,
        totalSessions: 4,
        usedSessions: 1,
      },
    });
    await prisma.giftCard.create({
      data: {
        networkId: network.id,
        code: `GC${RUN}`,
        initialValue: 100,
        remainingValue: 40,
        purchaserEmail: `cli-cartao-${RUN}@test.local`,
      },
    });

    const preview = await service.preview(owner.id);
    expect(preview).toMatchObject({
      activePackages: 1,
      packageRefunds: [{ currency: 'BRL', amount: 120 }],
      giftCards: 1,
      giftCardBalances: [{ currency: 'BRL', amount: 40 }],
    });
    // A prévia de encerrar a última unidade da rede mostra os cartões também
    expect(await barbershopService.getBarbershopDeletionPreview(owner.id, shop.id)).toMatchObject({
      activePackages: 1,
      giftCards: 1,
    });

    emails.length = 0;
    await service.deleteAccount(owner.id, { password: PASSWORD });
    const notices = emails.filter((e) => e.meta === 'balances-before-deletion').map((e) => e.to);
    expect(notices.sort()).toEqual([
      `cli-cartao-${RUN}@test.local`,
      `cli-pacote-${RUN}@test.local`,
    ]);
  });

  it('funcionário: o perfil de barbeiro fica na empresa, desligado da conta', async () => {
    const boss = await createUser('chefe', ownerRoleId);
    const { shop } = await createBusiness(boss.id, 'chefe');
    const staff = await createUser('barbeiro', ownerRoleId);
    const barber = await prisma.barber.create({
      data: { barbershopId: shop.id, name: 'Barbeiro', phone: '11988887777', userId: staff.id },
    });

    // Candidatura esperando resposta e convite ainda não aceito (item 192)
    const opening = await prisma.jobOpening.create({
      data: {
        barbershopId: shop.id,
        createdByUserId: boss.id,
        title: 'Freela de sábado',
        startDate: '2030-01-05',
        endDate: '2030-01-05',
      },
    });
    const application = await prisma.jobApplication.create({
      data: { jobOpeningId: opening.id, userId: staff.id },
    });
    const placeholder = await prisma.barber.create({
      data: { barbershopId: shop.id, name: 'Convidado', phone: '11977776666' },
    });
    const invite = await prisma.employeeInvite.create({
      data: {
        inviterId: boss.id,
        barbershopId: shop.id,
        barberId: placeholder.id,
        email: staff.email.toUpperCase(),
        inviteToken: `convite-${staff.id}`,
        role: 'BarbershopEmployee',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    expect((await service.preview(staff.id)).barbershops).toEqual([]);
    await service.deleteAccount(staff.id, { password: PASSWORD });
    expect(
      (await prisma.jobApplication.findUniqueOrThrow({ where: { id: application.id } })).status,
    ).toBe('withdrawn');
    expect(
      (await prisma.employeeInvite.findUniqueOrThrow({ where: { id: invite.id } })).status,
    ).toBe('CANCELLED');

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

  it('perfil público some da busca e do sitemap e a conta de recebimento desliga', async () => {
    const person = await createUser('perfil', ownerRoleId);
    const fullName = `Perfil Público ${RUN}`;
    await prisma.user.update({
      where: { id: person.id },
      data: { photoKey: null, fullName },
    });
    const slug = `perfil-${RUN}`;
    const professional = await prisma.professional.create({
      data: {
        userId: person.id,
        slug,
        visibility: 'public',
        isPublic: true,
        cities: ['São Paulo'],
      },
    });
    const account = await prisma.paymentAccount.create({
      data: {
        ownerType: 'professional',
        ownerId: professional.id,
        provider: 'fake',
        stripeAccountId: `acct_perfil_${RUN}`,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });

    const before = await barbershopService.searchPublicProfessionals({ query: fullName });
    expect(before.map((p) => p.slug)).toContain(slug);
    const sitemap = new SitemapService(prisma);
    expect(await sitemap.sitemapXml(1)).toContain(`/p/${slug}`);

    await service.deleteAccount(person.id, { password: PASSWORD });

    const after = await barbershopService.searchPublicProfessionals({ query: fullName });
    expect(after.map((p) => p.slug)).not.toContain(slug);
    expect(await sitemap.sitemapXml(1 + 4_000_000)).not.toContain(`/p/${slug}`);
    expect(await prisma.professional.findUnique({ where: { id: professional.id } })).toMatchObject({
      visibility: 'hidden',
      isPublic: false,
      slug: null,
    });
    expect(await prisma.paymentAccount.findUnique({ where: { id: account.id } })).toMatchObject({
      chargesEnabled: false,
      payoutsEnabled: false,
      disabledReason: 'account_deleted',
    });
    await prisma.paymentAccount.delete({ where: { id: account.id } });
  });

  it('pela equipe (backoffice, depois da confirmação): apaga sem a senha; conta do sistema não', async () => {
    const target = await createUser('pela-equipe', ownerRoleId);
    await service.deleteByStaff(target.id);
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();

    const admin = await createUser('admin-equipe', adminRoleId);
    await expect(service.deleteByStaff(admin.id)).rejects.toBeInstanceOf(ForbiddenException);
    const managerRoleId = (
      (await prisma.role.findFirst({ where: { name: 'SystemManager' } })) ??
      (await prisma.role.create({ data: { name: 'SystemManager' } }))
    ).id;
    const manager = await createUser('gerente-sistema', managerRoleId);
    await expect(service.deleteByStaff(manager.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('excluir a conta do dono da rede mantém a unidade do franqueado', async () => {
    const owner = await createUser('rede', ownerRoleId);
    const franchisee = await createUser('franq', ownerRoleId);
    const { network, shop } = await createBusiness(owner.id, 'rede');
    const theirs = await prisma.barbershop.create({
      data: {
        name: `Franquia ${RUN}`,
        slug: `franq-${RUN}`,
        address: 'Rua 2',
        city: 'São Paulo',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11988887777',
        email: `franq-${RUN}@test.local`,
        networkId: network.id,
        ownerUserId: franchisee.id,
      },
    });
    await service.deleteAccount(owner.id, { password: PASSWORD });
    const kept = await prisma.barbershop.findUnique({ where: { id: theirs.id } });
    expect(kept?.isActive).toBe(true);
    expect(kept?.closedAt).toBeNull();
    const closed = await prisma.barbershop.findUnique({ where: { id: shop.id } });
    expect(closed?.isActive).toBe(false);
  });
});
