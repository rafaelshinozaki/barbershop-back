import { UnauthorizedException } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';
import { AppPaymentsService } from './app-payments.service';
import { UserService } from '../auth/users/users.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PushService } from '../push/push.service';

jest.mock('../push/push-endpoint', () => ({
  assertPushEndpoint: async () => undefined,
}));

const CLOSED = 'A conta deste horário já foi fechada: estorne pelo painel do Stripe';
const logger = { log() {}, warn() {}, error() {} };

describe('estorno do sinal com a conta fechada (314)', () => {
  it('a unidade recusa o estorno', async () => {
    const refundOnlineDeposit = jest.fn();
    const shop = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(shop, {
      ensureAccess: async () => ({ id: 1 }),
      refundOnlineDeposit,
      prisma: {
        appointment: {
          findFirst: async () => ({
            depositRefundedAt: null,
            depositPaid: true,
            depositPaidAt: new Date(),
            sale: { id: 9 },
          }),
        },
      },
    });
    await expect(shop.refundAppointmentDeposit(1, 1, 5)).rejects.toThrow(CLOSED);
    expect(refundOnlineDeposit).not.toHaveBeenCalled();
  });

  it('o Financeiro recusa o estorno', async () => {
    const refundOnlineDeposit = jest.fn();
    const payments = Object.create(AppPaymentsService.prototype) as AppPaymentsService;
    Object.assign(payments, {
      logger,
      barbershops: { refundOnlineDeposit },
      prisma: {
        appointment: {
          findUnique: async () => ({
            depositPaidAt: new Date(),
            depositRefundedAt: null,
            depositPaymentIntentId: 'pi_sinal',
            sale: { id: 9 },
          }),
        },
      },
    });
    await expect(payments.refund('deposit', 5, null, 'cliente reclamou')).rejects.toThrow(CLOSED);
    expect(refundOnlineDeposit).not.toHaveBeenCalled();
  });
});

describe('aviso da sessão encerrada (316)', () => {
  it('a inscrição guarda a sessão, e encerrar uma apaga só a dela', async () => {
    const rows = [
      { endpoint: 'https://fcm.googleapis.com/a', sessionToken: 'sess-a' },
      { endpoint: 'https://fcm.googleapis.com/b', sessionToken: 'sess-b' },
    ];
    const push = Object.create(PushService.prototype) as PushService;
    Object.assign(push, {
      prisma: {
        pushSubscription: {
          upsert: async ({ create }: { create: { sessionToken?: string; endpoint: string } }) => {
            const row = rows.find((item) => item.endpoint === create.endpoint);
            if (row) row.sessionToken = create.sessionToken ?? row.sessionToken;
            else rows.push({ endpoint: create.endpoint, sessionToken: create.sessionToken ?? '' });
            return create;
          },
          findMany: async () => [],
          deleteMany: async () => ({ count: 0 }),
        },
      },
    });
    await push.subscribe(
      { userId: 1 },
      { endpoint: 'https://fcm.googleapis.com/c', p256dh: 'p', auth: 'a' },
      { sessionToken: 'sess-c' },
    );
    expect(rows.find((row) => row.endpoint.endsWith('/c'))?.sessionToken).toBe('sess-c');

    const user = Object.create(UserService.prototype) as UserService;
    Object.assign(user, {
      logger,
      prisma: {
        activeSession: {
          findFirst: async () => ({ id: 2, userId: 1, sessionToken: 'sess-b' }),
          delete: async () => ({}),
        },
        pushSubscription: {
          deleteMany: async ({ where }: { where: { sessionToken: string } }) => {
            const before = rows.length;
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i].sessionToken === where.sessionToken) rows.splice(i, 1);
            }
            return { count: before - rows.length };
          },
        },
      },
    });
    await user.terminateSession(1, 2, 'sess-a');
    expect(rows.map((row) => row.sessionToken).sort()).toEqual(['sess-a', 'sess-c']);
  });
});

describe('conta desativada (317)', () => {
  it('sessão aberta recebe 401 no REST', async () => {
    const strategy = Object.create(JwtStrategy.prototype) as JwtStrategy;
    const findSession = jest.fn(async () => ({ userId: 1 }));
    Object.assign(strategy, {
      userService: {
        getUserById: async () => ({ id: 1, isActive: false }),
        findActiveSessionByToken: findSession,
      },
    });
    await expect(
      strategy.validate({ userId: 1, sessionToken: 'sess-a', email: 'a@b.com' }),
    ).rejects.toThrow('Account disabled');
    expect(findSession).not.toHaveBeenCalled();
  });

  it('código certo no meio do login é recusado', async () => {
    const store = new Map<string, string>();
    const client = {
      get: async (key: string) => store.get(key) ?? null,
      del: async (...keys: string[]) => keys.reduce((n, key) => n + (store.delete(key) ? 1 : 0), 0),
      incr: async (key: string) => {
        const n = Number(store.get(key) ?? 0) + 1;
        store.set(key, String(n));
        return n;
      },
    };
    store.set('auth:login-code:login-1', JSON.stringify({ email: 'a@b.com', code: '123456' }));
    const findFirst = jest.fn(async () => ({
      id: 1,
      email: 'a@b.com',
      isActive: false,
      password: 'x',
      subscriptions: [],
      role: null,
    }));
    const user = Object.create(UserService.prototype) as UserService;
    Object.assign(user, {
      logger,
      redis: { client, getJson: async (key: string) => JSON.parse(store.get(key) as string) },
      prisma: { user: { findFirst } },
    });
    await expect(user.verifyLoginCode('login-1', '123456')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findFirst.mock.calls[0][0].where.isActive).toBe(true);
  });
});
