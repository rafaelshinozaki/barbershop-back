/**
 * Itens 351 a 360, contra o Postgres de verdade (Stripe, fila e e-mail
 * simulados).
 */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService, BILLING_CYCLE_MESSAGE } from '../plan/plan.service';
import { CouponsService } from '../payments/coupons.service';
import { RetentionService } from '../privacy/retention.service';
import { buildCalendar } from '../calendar/ics';
import { EmailService } from '../email/email.service';
import { BackofficeService, ADMIN_EMAIL_LINK_MESSAGE } from '../backoffice/backoffice.service';
import { PricingService } from '../pricing/pricing.service';
import { currentPricing } from '../pricing/pricing';
import { BarbershopService, NETWORK_FEE_TYPE_NEEDS_VALUE_MESSAGE } from './barbershop.service';
import { PLANO_STATUS } from '../common/contants';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86_400_000;
const mail = (label: string) => `r351-${label}-${RUN}@test.local`;

describe('Itens 351 a 360 (integração)', () => {
  const prisma = new PrismaService();
  let roleId: number;
  const userIds: number[] = [];

  const user = async (label: string, extra: Record<string, unknown> = {}) => {
    const u = await prisma.user.create({
      data: {
        email: mail(label),
        password: 'x',
        fullName: `Teste ${label}`,
        idDocNumber: `r351${label}${RUN}`.slice(-20),
        phone: '+5511900000000',
        gender: 'male',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        isActive: true,
        roleId,
        ...extra,
      },
    });
    userIds.push(u.id);
    return u;
  };
  const plan = async (name: string, price: number, billingCycle = 'MONTHLY') => {
    const p = await prisma.plan.create({
      data: { name: `${name} ${RUN}`, price, billingCycle, stripePriceId: `price_${name}` },
    });
    return p;
  };

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.coupon.deleteMany({ where: { code: { endsWith: RUN } } });
    const plans = await prisma.plan.findMany({
      where: { name: { endsWith: RUN } },
      withDeleted: true,
    } as never);
    for (const p of plans as { id: number }[]) {
      await prisma.$executeRaw`DELETE FROM "Plan" WHERE id = ${p.id}`.catch(() => undefined);
    }
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  describe('351: preço e ciclo do plano com assinantes', () => {
    const stripe = {
      createPrice: async () => ({ id: `price_novo_${RUN}` }),
      getPriceProductId: async () => 'prod_x',
      createProduct: async () => ({ id: 'prod_x' }),
    };
    const plans = new PlanService(prisma, stripe as never);

    it('com assinante: versão nova para quem assinar; quem já assina segue no preço antigo', async () => {
      const p = await plan('Pro', 100);
      const u = await user('assina');
      await prisma.subscription.create({
        data: { userId: u.id, planId: p.id, startSubDate: new Date(), status: PLANO_STATUS.ACTIVE },
      });
      const coupon = await prisma.coupon.create({
        data: {
          code: `SO${RUN}`,
          name: 'Só o Pro',
          type: 'PERCENTAGE',
          value: 10,
          applicablePlans: JSON.stringify([p.id]),
        },
      });

      const next = await plans.updatePlan(p.id, { price: 120 } as never);
      expect(next.id).not.toBe(p.id);
      expect(Number(next.price)).toBe(120);
      expect(next.stripePriceId).toBe(`price_novo_${RUN}`);

      // A assinatura continua no plano antigo, com o preço antigo
      const sub = await prisma.subscription.findFirstOrThrow({
        where: { userId: u.id },
        include: { plan: true },
      });
      expect(sub.planId).toBe(p.id);
      expect(Number(sub.plan.price)).toBe(100);
      // O antigo sai da lista; o novo entra
      const listed = (await plans.findAllPlans()).map((x) => x.id);
      expect(listed).toContain(next.id);
      expect(listed).not.toContain(p.id);
      // O cupom do plano vale para a versão nova
      const c = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      expect(JSON.parse(c.applicablePlans as string)).toEqual([p.id, next.id]);
    });

    it('sem assinante muda no lugar; ciclo fora de MONTHLY/YEARLY é recusado', async () => {
      const p = await plan('Solto', 50);
      const same = await plans.updatePlan(p.id, { price: 60, billingCycle: 'yearly' } as never);
      expect(same.id).toBe(p.id);
      expect(same.billingCycle).toBe('YEARLY');
      await expect(plans.updatePlan(p.id, { billingCycle: 'WEEKLY' } as never)).rejects.toThrow(
        BILLING_CYCLE_MESSAGE,
      );
      await expect(
        plans.createPlan({ name: `X ${RUN}`, price: 10, billingCycle: 'ANUAL' } as never),
      ).rejects.toThrow(BILLING_CYCLE_MESSAGE);
    });
  });

  describe('352: meses mínimos de assinatura', () => {
    const coupons = new CouponsService(prisma);

    it('só plano pago conta, sem contar duas vezes a sobreposição nem depois do fim', async () => {
      const free = await plan('Gratis', 0);
      const paid = await plan('Pago', 50);
      const u = await user('meses');
      const now = Date.now();
      // Gratuito há um ano: não conta
      await prisma.subscription.create({
        data: {
          userId: u.id,
          planId: free.id,
          startSubDate: new Date(now - 365 * DAY),
          status: PLANO_STATUS.ACTIVE,
        },
      });
      expect(await coupons.paidSubscriptionMonths(u.id)).toBe(0);
      // Pago de 200 a 110 dias atrás (vencido, sem cancelamento): 3 meses
      await prisma.subscription.create({
        data: {
          userId: u.id,
          planId: paid.id,
          startSubDate: new Date(now - 200 * DAY),
          currentPeriodEnd: new Date(now - 110 * DAY),
          status: PLANO_STATUS.INACTIVE,
        },
      });
      // Outro pago que começa no meio do anterior e vai até 50 dias atrás
      await prisma.subscription.create({
        data: {
          userId: u.id,
          planId: paid.id,
          startSubDate: new Date(now - 150 * DAY),
          cancelationDate: new Date(now - 50 * DAY),
          status: PLANO_STATUS.INACTIVE,
        },
      });
      // 200 → 50 dias atrás sem repetir: 150 dias = 5 meses
      expect(await coupons.paidSubscriptionMonths(u.id)).toBe(5);

      const coupon = await prisma.coupon.create({
        data: {
          code: `FIEL${RUN}`,
          name: 'Fiel',
          type: 'PERCENTAGE',
          value: 10,
          minSubscriptionMonths: 6,
        },
      });
      const r = await coupons.validateCoupon(coupon.code, u.id, paid.id, 50);
      expect(r).toMatchObject({ isValid: false });
      expect(r.error).toContain('6 meses');
    });
  });

  describe('353: guarda de convites e links do cliente', () => {
    it('convite vencido e não aceito sai; aceito e vaga ativa pendente ficam; link usado sai', async () => {
      const owner = await user('dono');
      const network = await prisma.network.create({
        data: { ownerUserId: owner.id, name: `Rede ${RUN}` },
      });
      const shop = await prisma.barbershop.create({
        data: {
          name: `Unidade ${RUN}`,
          slug: `r351-${RUN}`,
          address: 'Rua',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: mail('shop'),
          networkId: network.id,
          ownerUserId: owner.id,
        },
      });
      const old = new Date(Date.now() - 100 * DAY);
      const seat = async (isActive: boolean) =>
        prisma.barber.create({
          data: { barbershopId: shop.id, name: 'Vaga', phone: '1', isActive },
        });
      const invite = (barberId: number, status: string, label: string) =>
        prisma.employeeInvite.create({
          data: {
            barbershopId: shop.id,
            barberId,
            inviterId: owner.id,
            email: mail(label),
            role: 'BarbershopEmployee',
            inviteToken: `${label}-${RUN}`,
            status,
            expiresAt: old,
          },
        });
      const gone = await invite((await seat(false)).id, 'PENDING', 'vaga-fechada');
      const expired = await invite((await seat(true)).id, 'EXPIRED', 'vencido');
      const openSeat = await invite((await seat(true)).id, 'PENDING', 'vaga-aberta');
      const accepted = await invite((await seat(true)).id, 'ACCEPTED', 'aceito');
      const friendOld = await prisma.friendInvite.create({
        data: {
          inviterId: owner.id,
          friendEmail: mail('amigo'),
          inviteToken: `amigo-${RUN}`,
          expiresAt: old,
        },
      });
      const account = await prisma.clientAccount.create({
        data: { email: mail('cliente'), name: 'Cliente' },
      });
      const used = await prisma.clientAccountToken.create({
        data: {
          clientAccountId: account.id,
          purpose: 'VERIFY_EMAIL',
          tokenHash: `usado-${RUN}`,
          expiresAt: new Date(Date.now() + DAY),
          usedAt: new Date(),
        },
      });
      const live = await prisma.clientAccountToken.create({
        data: {
          clientAccountId: account.id,
          purpose: 'VERIFY_EMAIL',
          tokenHash: `valendo-${RUN}`,
          expiresAt: new Date(Date.now() + DAY),
        },
      });

      await new RetentionService(prisma).run();

      const left = (await prisma.employeeInvite.findMany({ where: { barbershopId: shop.id } })).map(
        (i) => i.id,
      );
      expect(left).not.toContain(gone.id);
      expect(left).not.toContain(expired.id);
      expect(left).toEqual(expect.arrayContaining([openSeat.id, accepted.id]));
      expect(await prisma.friendInvite.count({ where: { id: friendOld.id } })).toBe(0);
      expect(await prisma.clientAccountToken.count({ where: { id: used.id } })).toBe(0);
      expect(await prisma.clientAccountToken.count({ where: { id: live.id } })).toBe(1);

      await prisma.clientAccountToken.deleteMany({ where: { clientAccountId: account.id } });
      await prisma.clientAccount.delete({ where: { id: account.id } });
      await prisma.employeeInvite.deleteMany({ where: { barbershopId: shop.id } });
      await prisma.barber.deleteMany({ where: { barbershopId: shop.id } });
      await prisma.barbershop.delete({ where: { id: shop.id } });
      await prisma.network.delete({ where: { id: network.id } });
    });
  });

  it('354: \\r sozinho no texto do evento sai escapado, numa linha só', () => {
    const ics = buildCalendar([
      {
        uid: 'x',
        start: new Date(),
        end: new Date(),
        summary: 'Nome\rDTSTART:20300101T000000Z',
      },
    ]);
    expect(ics).toContain('SUMMARY:Nome\\nDTSTART:20300101T000000Z');
    expect(ics.split('\r\n').some((l) => l.startsWith('DTSTART:2030'))).toBe(false);
  });

  it('355: e-mail que saiu não vira erro quando a cópia não grava', async () => {
    let sends = 0;
    const email = new EmailService(
      { send: async () => (sends++, { id: 'ok' }) } as never,
      {
        emailLogger: {
          create: async () => {
            throw new Error('banco fora');
          },
        },
      } as never,
      { get: () => 'noreply@test.local' } as never,
    );
    (email as unknown as { render: unknown }).render = async () => ({
      html: '<p>oi</p>',
      subject: 'Oi',
    });
    await expect(
      email.sendCustomerEmail(null, 'qualquer', {}, 'Oi', 'teste', 'a@b.c'),
    ).resolves.toBe('Email sent successfully');
    expect(sends).toBe(1);
  });

  describe('356 e 357: e-mail da equipe', () => {
    it('um envio por conta ativa, id fixo por pessoa e link só do app', async () => {
      const jobs: { job: { userId: number; context: { actionUrl?: string } }; id?: string }[] = [];
      const queue = { email: async (job: never, id?: string) => void jobs.push({ job, id }) };
      const service = new BackofficeService(prisma, {} as never, queue as never);
      const ok = await user('ativo');
      const off = await user('desativado', { isActive: false });
      const input = {
        userIds: [ok.id, off.id],
        subject: `Aviso ${RUN}`,
        message: 'Olá',
        actionUrl: 'https://golpe.example.com/login',
        actionText: 'Entrar',
      };
      await service.sendEmailNotification(input);
      expect(jobs.map((j) => j.job.userId)).toEqual([ok.id]);
      // Link de fora não sai no botão
      expect(jobs[0].job.context.actionUrl).toBeUndefined();
      // De novo (nova tentativa do comando): o mesmo id, a fila não repete
      await service.sendEmailNotification(input);
      expect(jobs[1].id).toBe(jobs[0].id);
      expect(jobs[0].id).not.toContain(':');

      expect(() => service.assertSafeActionUrl('https://golpe.example.com')).toThrow(
        ADMIN_EMAIL_LINK_MESSAGE,
      );
      expect(() => service.assertSafeActionUrl('/plans')).not.toThrow();
    });
  });

  it('358: salvar um preço não desfaz o que mudou no banco por fora', async () => {
    const before = await prisma.platformSetting.findUnique({ where: { key: 'pricing' } });
    const admin = await user('admin');
    try {
      const pricing = new PricingService(prisma);
      await pricing.reload();
      const cachedFee = currentPricing().platformFeePercent;
      // Outro admin (backoffice-back) mudou a taxa direto no banco
      const fee = cachedFee === 12 ? 13 : 12;
      await prisma.platformSetting.upsert({
        where: { key: 'pricing' },
        create: { key: 'pricing', value: { ...currentPricing(), platformFeePercent: fee } },
        update: { value: { ...currentPricing(), platformFeePercent: fee } },
      });
      await pricing.update(admin.id, { featuredDays: 15 });
      expect(currentPricing()).toMatchObject({ platformFeePercent: fee, featuredDays: 15 });
    } finally {
      if (before) {
        await prisma.platformSetting.update({
          where: { key: 'pricing' },
          data: { value: before.value as never, updatedByUserId: before.updatedByUserId },
        });
      } else {
        await prisma.platformSetting.deleteMany({ where: { key: 'pricing' } });
      }
      await new PricingService(prisma).reload();
    }
  });

  describe('359 e 360: taxa de falta e preço do clube', () => {
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

    it('trocar só o tipo da taxa é recusado; a taxa não passa do valor dos serviços', async () => {
      const owner = await user('taxa');
      const network = await prisma.network.create({
        data: {
          ownerUserId: owner.id,
          name: `Taxa ${RUN}`,
          noShowFeeEnabled: true,
          noShowFeeType: 'FIXED',
          noShowFeeValue: 150,
        },
      });
      const shop = await prisma.barbershop.create({
        data: {
          name: `Unidade taxa ${RUN}`,
          slug: `r351-taxa-${RUN}`,
          address: 'Rua',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: mail('taxa-shop'),
          networkId: network.id,
          ownerUserId: owner.id,
        },
      });
      try {
        await expect(shops.updateNetwork(owner.id, { noShowFeeType: 'PERCENT' })).rejects.toThrow(
          NETWORK_FEE_TYPE_NEEDS_VALUE_MESSAGE,
        );
        // Com o valor junto, passa
        await shops.updateNetwork(owner.id, { noShowFeeType: 'PERCENT', noShowFeeValue: 50 });
        await shops.updateNetwork(owner.id, { noShowFeeType: 'FIXED', noShowFeeValue: 150 });

        const fee = await (
          shops as unknown as {
            noShowFeeFor: (
              id: number,
              a: unknown,
              status: string,
            ) => Promise<{ amount: number } | null>;
          }
        ).noShowFeeFor(
          shop.id,
          {
            startAt: new Date(Date.now() + DAY),
            services: [{ unitPrice: new Decimal(40), quantity: 1 }],
          },
          'NO_SHOW',
        );
        expect(fee?.amount).toBe(40);
      } finally {
        await prisma.barbershop.delete({ where: { id: shop.id } });
        await prisma.network.delete({ where: { id: network.id } });
      }
    });

    it('a assinatura do clube mostra o preço contratado, não o atual do plano', () => {
      const toResult = (
        shops as unknown as { toClientSubscriptionResult: (s: unknown) => { price: number } }
      ).toClientSubscriptionResult.bind(shops);
      const base = {
        id: 1,
        barbershopId: 1,
        clientAccountId: 1,
        planId: 1,
        status: 'ACTIVE',
        usedThisCycle: 0,
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        plan: { name: 'Clube', price: new Decimal(120) },
      };
      expect(toResult({ ...base, price: new Decimal(100) }).price).toBe(100);
      // Assinatura de antes da coluna: cai no preço do plano
      expect(toResult({ ...base, price: null }).price).toBe(120);
    });
  });
});
