/**
 * Itens 483 a 487 (segurança), contra o Postgres de verdade: o state do
 * login social da equipe, o login do cliente com a senha da equipe no mesmo
 * bloqueio por e-mail, o provedor desconectado que não religa sozinho, o
 * prazo do link do suporte e o e-mail em massa (preferência, descadastro e
 * texto escapado).
 */
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import {
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from './users/users.service';
import { AuthController } from './auth.controller';
import {
  assertStaffOAuthState,
  STAFF_OAUTH_STATE_COOKIE,
  staffOAuthStateOptions,
} from './oauth-state';
import {
  AccountLinkService,
  STAFF_LOGIN_BLOCKED_MESSAGE,
} from '../client-auth/account-link.service';
import {
  ClientAuthService,
  STAFF_TWO_FACTOR_CLIENT_LOGIN_MESSAGE,
} from '../client-auth/client-auth.service';
import { memoryRedis } from './signup-code.testing-spec';
import { SupportService, SUPPORT_LINK_DAYS } from '../support/support.service';
import { createSupportToken } from '../barbershop/appointment-link';
import { BackofficeService } from '../backoffice/backoffice.service';
import { NewsUnsubscribeController } from '../notifications/news-unsubscribe.controller';
import { createNewsUnsubscribeToken } from '../notifications/news-unsubscribe';
import { LOGIN_MAX_ATTEMPTS } from '../common/contants';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'Equipe#Forte1';

const httpContext = (req: Record<string, unknown>) => {
  const cookies: Record<string, unknown> = {};
  const res = {
    cookie: (name: string, value: string) => (cookies[name] = value),
    clearCookie: (name: string) => delete cookies[name],
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, cookies };
};

describe('Itens 483 a 487 (integração)', () => {
  const prisma = new PrismaService();
  const email = {
    sendCustomerEmail: async () => undefined,
    sendTemplateEmail: async () => undefined,
  };
  const redis = memoryRedis();
  const users = new UserService(
    prisma,
    email as never,
    {} as never,
    { get: () => undefined } as never,
    redis as never,
  );
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const config = {
    get: (key: string) =>
      ({
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_EXPIRATION: '3600',
        FRONTEND_URL: 'https://app.test',
      }[key]),
  };
  const link = new AccountLinkService(prisma, email as never, redis as never);
  const clients = new ClientAuthService(
    prisma,
    jwt,
    config as never,
    email as never,
    {} as never,
    link,
    redis as never,
  );
  let roleId: number;
  const userIds: number[] = [];
  const mail = (label: string) => `r483-${label}-${RUN}@test.local`;

  const staff = async (label: string, extra: Record<string, unknown> = {}) => {
    const u = await prisma.user.create({
      data: {
        email: mail(label),
        password: await bcrypt.hash(PASSWORD, 10),
        fullName: `Equipe ${label}`,
        idDocNumber: `r483${label}${RUN}`.slice(-20),
        phone: '+5511900000000',
        gender: 'female',
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

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
  });

  afterAll(async () => {
    const accounts = await prisma.clientAccount.findMany({
      where: { email: { endsWith: `-${RUN}@test.local` } },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);
    await prisma.clientLinkedSocialAccount.deleteMany({
      where: { clientAccountId: { in: accountIds } },
    });
    await prisma.clientAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.supportTicket.deleteMany({ where: { email: { endsWith: `-${RUN}@test.local` } } });
    await prisma.linkedSocialAccount.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.activeSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('483: o login social da equipe exige o state do cookie na volta', () => {
    const start = httpContext({ path: '/auth/google' });
    const { state } = staffOAuthStateOptions(start.ctx);
    expect(start.cookies[STAFF_OAUTH_STATE_COOKIE]).toBe(state);
    const ok = httpContext({
      path: '/auth/google/redirect',
      query: { state },
      cookies: { [STAFF_OAUTH_STATE_COOKIE]: state },
    });
    expect(() => assertStaffOAuthState(ok.ctx)).not.toThrow();
    // Link de volta montado por outra pessoa: sem o cookie desta pessoa
    const forged = httpContext({ path: '/auth/google/redirect', query: { state }, cookies: {} });
    expect(() => assertStaffOAuthState(forged.ctx)).toThrow(ForbiddenException);
  });

  it('483: cookie de sessão encerrada não liga outro login à conta', async () => {
    const u = await staff('sessao');
    const sessionToken = `s-${RUN}`;
    await prisma.activeSession.create({
      data: {
        userId: u.id,
        sessionToken,
        deviceType: 'Desktop',
        browser: 'x',
        os: 'x',
        ip: '127.0.0.1',
        location: '',
      },
    });
    const controller = new AuthController({} as never, users, config as never, jwt);
    const cookie = jwt.sign({ userId: u.id, sessionToken });
    const current = (
      controller as never as {
        getCurrentSessionUserId: (req: unknown) => Promise<number | null>;
      }
    ).getCurrentSessionUserId.bind(controller);
    expect(await current({ cookies: { Authentication: cookie } })).toBe(u.id);
    await prisma.activeSession.deleteMany({ where: { sessionToken } });
    expect(await current({ cookies: { Authentication: cookie } })).toBeNull();
  });

  it('484: o login do cliente com a senha da equipe conta no bloqueio por e-mail', async () => {
    await staff('chute');
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      await expect(
        clients.validateCredentials(mail('chute'), `Errada#${i}x`),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    // Bloqueada: nem a senha certa entra por aqui (como no login da equipe)
    const blocked = clients.validateCredentials(mail('chute'), PASSWORD);
    await expect(blocked).rejects.toBeInstanceOf(HttpException);
    await expect(blocked).rejects.toThrow(STAFF_LOGIN_BLOCKED_MESSAGE);
  });

  it('484: conta da equipe com verificação em duas etapas não entra pelo login do cliente', async () => {
    await staff('2fa', { twoFactorEnabled: true });
    await expect(clients.validateCredentials(mail('2fa'), PASSWORD)).rejects.toThrow(
      STAFF_TWO_FACTOR_CLIENT_LOGIN_MESSAGE,
    );
    expect(await prisma.clientAccount.count({ where: { email: mail('2fa') } })).toBe(0);
    // Sem 2FA, a senha certa entra e zera o contador
    await staff('ok');
    await expect(clients.validateCredentials(mail('ok'), 'Errada#1x')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect((await clients.validateCredentials(mail('ok'), PASSWORD)).email).toBe(mail('ok'));
    expect(redis.store.has(`auth:login-fails:${mail('ok')}`)).toBe(false);
  });

  it('485: desconectar o Google impede o login pelo mesmo e-mail até ligar de novo', async () => {
    const u = await staff('google');
    const first = await users.findOrCreateSocialUser(
      mail('google'),
      'Equipe',
      'google',
      `g-${RUN}`,
    );
    expect(first.id).toBe(u.id);
    await users.unlinkSocialAccount(u.id, 'google');
    await expect(
      users.findOrCreateSocialUser(mail('google'), 'Equipe', 'google', `g-${RUN}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // Logada, liga de novo: volta a valer
    expect(await users.linkSocialAccountToUser(u.id, mail('google'), 'google', `g-${RUN}`)).toEqual(
      {
        ok: true,
      },
    );
    expect(
      (await users.findOrCreateSocialUser(mail('google'), 'Equipe', 'google', `g-${RUN}`)).id,
    ).toBe(u.id);
  });

  it('485: o mesmo vale para a conta de cliente', async () => {
    const account = await clients.findOrCreateSocialAccount(
      mail('cli-google'),
      'Cliente',
      'google',
      `cg-${RUN}`,
    );
    await clients.unlinkSocialAccount(account.id, 'google');
    await expect(
      clients.findOrCreateSocialAccount(mail('cli-google'), 'Cliente', 'google', `cg-${RUN}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await clients.linkSocialAccountToClient(account.id, mail('cli-google'), 'google', `cg-${RUN}`);
    expect(
      (
        await clients.findOrCreateSocialAccount(
          mail('cli-google'),
          'Cliente',
          'google',
          `cg-${RUN}`,
        )
      ).id,
    ).toBe(account.id);
  });

  it('486: o link do pedido de suporte vence depois do prazo', async () => {
    const support = new SupportService(
      prisma,
      email as never,
      { notifyUsers: () => undefined } as never,
      { sendToUsers: async () => 0 } as never,
    );
    const ticket = await prisma.supportTicket.create({
      data: {
        name: 'Ana',
        email: mail('suporte'),
        category: 'other',
        subject: 'Ajuda',
        messages: { create: { side: 'requester', body: 'Olá' } },
      },
    });
    const token = createSupportToken(ticket.id);
    expect((await support.forRequester(token)).id).toBe(ticket.id);
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { lastActivityAt: new Date(Date.now() - (SUPPORT_LINK_DAYS + 1) * 86_400_000) },
    });
    await expect(support.forRequester(token)).rejects.toBeInstanceOf(NotFoundException);
    await expect(support.requesterReply(token, 'Oi de novo')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('487: e-mail em massa respeita "novidades", leva o descadastro e o link desliga', async () => {
    process.env.PUBLIC_API_URL = 'https://api.test';
    const recebe = await staff('news-sim', { notificationPreference: { create: {} } });
    const saiu = await staff('news-nao', {
      notificationPreference: { create: { newsEmail: false } },
    });
    const jobs: { job: { userId: number; headers?: Record<string, string>; context: any } }[] = [];
    const queue = { email: async (job: never) => void jobs.push({ job }) };
    const service = new BackofficeService(prisma, {} as never, queue as never);
    await service.sendEmailNotification({
      userIds: [recebe.id, saiu.id],
      subject: `Novidade ${RUN}`,
      message: '<a href="https://golpe.example.com">Clique</a>',
    });
    expect(jobs.map((j) => j.job.userId)).toEqual([recebe.id]);
    const sent = jobs[0].job;
    expect(sent.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(sent.context.unsubscribeUrl).toContain('/notifications/unsubscribe-news?t=');

    // O modelo escapa o texto da equipe (antes entrava como HTML)
    for (const lang of ['pt', 'en', 'es']) {
      const source = fs.readFileSync(
        path.join(__dirname, `../email/templates/${lang}/admin_notification.hbs`),
        'utf8',
      );
      const html = Handlebars.compile(source)(sent.context);
      expect(html).not.toContain('<a href="https://golpe.example.com">');
      expect(html).toContain('&lt;a href');
      expect(html).toContain(sent.context.unsubscribeUrl.replace(/&/g, '&amp;').split('?')[0]);
    }

    // O link desliga a preferência; link adulterado não mexe em nada
    const controller = new NewsUnsubscribeController(prisma);
    await controller.unsubscribe(`${saiu.id}.${'x'.repeat(32)}`);
    await controller.unsubscribe(createNewsUnsubscribeToken(recebe.id));
    const pref = await prisma.notificationPreference.findUnique({ where: { userId: recebe.id } });
    expect(pref?.newsEmail).toBe(false);
    expect(controller.confirm(createNewsUnsubscribeToken(recebe.id))).toContain('method="post"');
    delete process.env.PUBLIC_API_URL;
  });
});
