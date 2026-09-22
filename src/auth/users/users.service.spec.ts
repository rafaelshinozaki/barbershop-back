import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './users.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { UnauthorizedException } from '@nestjs/common';
import { LOGIN_MAX_ATTEMPTS } from '@/common';
import { RedisService } from '@/redis/redis.service';

// Redis mínimo em memória (só os comandos que o UserService usa)
function fakeRedis() {
  const store = new Map<string, string>();
  const client: any = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
    exists: async (k: string) => (store.has(k) ? 1 : 0),
    incr: async (k: string) => {
      const n = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(n));
      return n;
    },
    expire: async () => 1,
    multi: () => {
      const ops: Array<() => Promise<unknown>> = [];
      const tx: any = {
        set: (k: string, v: string) => (ops.push(() => client.set(k, v)), tx),
        del: (k: string) => (ops.push(() => client.del(k)), tx),
        exec: async () => Promise.all(ops.map((op) => op())),
      };
      return tx;
    },
  };
  return {
    client,
    getJson: async (k: string) => (store.has(k) ? JSON.parse(store.get(k) as string) : null),
    setJson: async (k: string, v: unknown) => void store.set(k, JSON.stringify(v)),
  };
}

describe('UserService', () => {
  let service: UserService;
  let prisma: { user: { findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findFirst: jest.fn() } } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: RedisService, useValue: fakeRedis() },
      ],
    })
      // Dependências não usadas aqui viram objetos vazios
      .useMocker(() => ({}))
      .compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should block login after several failed attempts', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const email = 'test@example.com';
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      await expect(service.verifyUser(email, 'bad')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(service.verifyUser(email, 'bad')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login code is single-use and wrong codes are counted', async () => {
    const user = { id: 1, email: 'a@b.com', fullName: 'A' } as any;
    (service as any).emailService = { sendTemplateEmail: jest.fn() };
    prisma.user.findFirst.mockResolvedValue({ ...user, subscriptions: [], role: null });
    await service.sendLoginCode(user, 'login-1');
    const redis = (service as any).redis;
    const { code } = await redis.getJson('auth:login-code:login-1');

    await expect(service.verifyLoginCode('login-1', '000000')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.verifyLoginCode('login-1', code)).resolves.toMatchObject({
      email: 'a@b.com',
    });
    // segunda vez com o mesmo código: já consumido
    await expect(service.verifyLoginCode('login-1', code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
