import { UnauthorizedException } from '@nestjs/common';
import { ClientAuthController } from '../client-auth/client-auth.controller';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { UserService } from '../auth/users/users.service';
import { PaymentsService } from '../payments/payments.service';
import { BackofficeResolver } from '../graphql/resolvers/backoffice.resolver';
import { PLANO_STATUS } from '../common/contants';

describe('conectar grava o id do provedor (298)', () => {
  it('grava o id, e o login com o mesmo e-mail e outro id é recusado', async () => {
    const upserts: { create?: { providerUserId?: string | null } }[] = [];
    const userLookups = jest.fn();
    const links = [
      {
        id: 1,
        userId: 4,
        provider: 'google',
        providerEmail: 'ana@x.com',
        providerUserId: 'pessoa-a',
      },
    ];
    const prisma = {
      linkedSocialAccount: {
        findFirst: async ({
          where,
        }: {
          where: { providerUserId?: string; providerEmail?: unknown };
        }) => {
          if (where.providerUserId) {
            return links.find((l) => l.providerUserId === where.providerUserId) ?? null;
          }
          if (where.providerEmail) return links[0];
          return null;
        },
        findUnique: async () => null,
        upsert: async (args: { create?: { providerUserId?: string | null } }) => {
          upserts.push(args);
          return args;
        },
      },
      user: { findFirst: async () => null, findUnique: userLookups },
    };
    const users = Object.create(UserService.prototype) as UserService;
    (users as unknown as { prisma: typeof prisma }).prisma = prisma;

    const fresh = Object.create(UserService.prototype) as UserService;
    (fresh as unknown as { prisma: typeof prisma }).prisma = {
      ...prisma,
      linkedSocialAccount: {
        ...prisma.linkedSocialAccount,
        findFirst: async () => null,
      },
    };
    await fresh.linkSocialAccountToUser(4, 'ana@x.com', 'google', 'pessoa-a');
    expect(upserts[0].create?.providerUserId).toBe('pessoa-a');

    await expect(
      users.findOrCreateSocialUser('ana@x.com', 'Ana', 'google', 'pessoa-b'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userLookups).not.toHaveBeenCalled();
  });

  it('a conta de cliente grava o id do mesmo jeito', async () => {
    const upserts: { create?: { providerUserId?: string | null } }[] = [];
    const accountLookups = jest.fn();
    const links = [
      {
        id: 1,
        clientAccountId: 4,
        provider: 'google',
        providerEmail: 'ana@x.com',
        providerUserId: 'pessoa-a',
      },
    ];
    const clients = Object.create(ClientAuthService.prototype) as ClientAuthService;
    (clients as unknown as { prisma: object }).prisma = {
      clientLinkedSocialAccount: {
        findFirst: async ({ where }: { where: { providerUserId?: string } }) =>
          where.providerUserId
            ? links.find((l) => l.providerUserId === where.providerUserId) ?? null
            : links[0],
        findUnique: async () => links[0],
        upsert: async (args: { create?: { providerUserId?: string | null } }) => {
          upserts.push(args);
          return args;
        },
      },
      clientAccount: { findFirst: async () => null, findUnique: accountLookups },
    };
    const fresh = Object.create(ClientAuthService.prototype) as ClientAuthService;
    (fresh as unknown as { prisma: object }).prisma = {
      clientLinkedSocialAccount: {
        findFirst: async () => null,
        findUnique: async () => null,
        upsert: async (args: { create?: { providerUserId?: string | null } }) => {
          upserts.push(args);
          return args;
        },
      },
      clientAccount: { findFirst: async () => null },
    };
    await fresh.linkSocialAccountToClient(4, 'ana@x.com', 'google', 'pessoa-a');
    expect(upserts[0].create?.providerUserId).toBe('pessoa-a');

    await expect(
      clients.findOrCreateSocialAccount('ana@x.com', 'Ana', 'google', 'pessoa-b'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(accountLookups).not.toHaveBeenCalled();
  });
});

describe('login social do cliente recusado volta pra tela (299)', () => {
  it('redireciona para /client/login?error=social', async () => {
    const controller = new ClientAuthController(
      {
        findOrCreateSocialAccount: async () => {
          throw new UnauthorizedException(
            'Este e-mail já está ligado a outra pessoa neste provedor. Entre com a senha.',
          );
        },
      } as never,
      { get: (key: string) => (key === 'FRONTEND_URL' ? 'https://app.test' : undefined) } as never,
      {} as never,
    );
    const redirect = jest.fn();
    await (
      controller as unknown as {
        completeSocialLogin: (...args: unknown[]) => Promise<void>;
      }
    ).completeSocialLogin(
      { email: 'ana@x.com', displayName: 'Ana', providerUserId: 'pessoa-b' },
      'google',
      { cookies: {} },
      { redirect },
    );
    expect(redirect).toHaveBeenCalledWith('https://app.test/client/login?error=social');
  });
});

describe('cobranças de plano vencidas (304)', () => {
  const payment = (id: number, when: string) => ({
    id,
    subscriptionId: 1,
    nextPaymentDate: new Date(when),
    amount: 39.9,
    subscription: {
      user: {
        id: 1,
        email: 'ana@x.com',
        fullName: 'Ana',
        membership: 'PAID',
        stripeCustomerId: null,
      },
      plan: { id: 1, name: 'Pro', price: 39.9, billingCycle: 'MONTHLY' },
    },
  });

  it('três mensalidades da mesma assinatura viram uma, e a consulta exige o período vencido', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        payment(1, '2026-08-01'),
        payment(2, '2026-09-01'),
        payment(3, '2026-10-01'),
      ]);
    const resolver = Object.create(BackofficeResolver.prototype) as BackofficeResolver;
    (resolver as unknown as { prisma: object; logger: object }).prisma = {
      payment: { findMany },
    };
    (resolver as unknown as { logger: { error: () => void; log: () => void } }).logger = {
      error() {},
      log() {},
    };
    const rows = await resolver.allOverduePayments();
    expect(rows.map((r) => r.id)).toEqual([3]);
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('COMPLETED');
    expect(where.subscription.status).toBe(PLANO_STATUS.ACTIVE);
    expect(where.subscription.stripeSubscriptionId).toBeNull();
    expect(where.subscription.currentPeriodEnd.lte).toBeInstanceOf(Date);
    expect(where.nextPaymentDate.lte).toBeInstanceOf(Date);
  });
});

describe('estorno da diferença do plano (305)', () => {
  const end = new Date('2026-11-01T00:00:00Z');

  it('a cobrança da diferença guarda o plano anterior', async () => {
    const created: { kind?: string; previousPlanId?: number }[] = [];
    const svc = Object.create(PaymentsService.prototype) as PaymentsService;
    (svc as unknown as { prisma: object; stripeService: object; logger: object }).prisma = {
      user: { findUnique: async () => ({ stripeCustomerId: 'cus_1' }) },
      payment: {
        findFirst: async () => null,
        create: async ({ data }: { data: { kind?: string; previousPlanId?: number } }) => {
          created.push(data);
          return data;
        },
      },
    };
    (svc as unknown as { stripeService: object }).stripeService = {
      getDefaultPaymentMethodId: async () => 'pm_1',
      chargeOffSession: async () => ({ id: 'pi_up', status: 'succeeded' }),
    };
    (svc as unknown as { logger: object }).logger = { warn() {}, error() {}, log() {} };
    await (
      svc as unknown as { chargeUpgrade: (...args: unknown[]) => Promise<Date> }
    ).chargeUpgrade(
      {
        id: 1,
        userId: 2,
        planId: 10,
        currentPeriodEnd: end,
        plan: { price: 30, billingCycle: 'MONTHLY' },
      },
      { id: 20, price: 60, billingCycle: 'MONTHLY' },
      new Date('2026-10-16T00:00:00Z'),
    );
    expect(created[0].kind).toBe('plan_upgrade');
    expect(created[0].previousPlanId).toBe(10);
  });

  it('estornar a diferença volta ao plano A e mantém o vencimento', async () => {
    const updates: { planId?: number }[] = [];
    const expire = jest.fn();
    const cancel = jest.fn();
    const svc = Object.create(PaymentsService.prototype) as PaymentsService;
    (svc as unknown as { prisma: object; stripeService: object; logger: object }).prisma = {
      payment: {
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({
          id: 8,
          kind: 'plan_upgrade',
          previousPlanId: 10,
          subscription: {
            id: 1,
            userId: 2,
            status: 'ACTIVE',
            stripeSubscriptionId: null,
            currentPeriodEnd: end,
          },
        }),
        findFirst: async () => {
          throw new Error('não procura a cobrança do período');
        },
      },
      subscription: {
        update: async ({ data }: { data: { planId?: number } }) => {
          updates.push(data);
        },
      },
    };
    (svc as unknown as { stripeService: { cancelSubscription: jest.Mock } }).stripeService = {
      cancelSubscription: cancel,
    };
    (svc as unknown as { logger: object; expireSubscription: jest.Mock }).logger = {
      log() {},
      warn() {},
    };
    (svc as unknown as { expireSubscription: jest.Mock }).expireSubscription = expire;
    await (
      svc as unknown as { markPlanPaymentRefunded: (id: number) => Promise<void> }
    ).markPlanPaymentRefunded(8);
    expect(updates).toEqual([{ planId: 10 }]);
    expect(expire).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});
