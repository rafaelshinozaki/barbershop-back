/**
 * Conta do cliente final contra o Postgres de verdade (e-mail simulado).
 *
 * Antes, cadastrar a conta com o e-mail (ou o telefone) de outra pessoa ligava
 * as fichas dela em todas as barbearias à conta nova — dava pra ver onde,
 * quando e quanto ela gastou. Agora só o e-mail confirmado pelo link liga.
 */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ClientAuthService } from './client-auth.service';
import { GraphQLClientJwtAuthGuard } from './guards/graphql-client-jwt-auth.guard';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const SECRET = 'segredo-de-teste';
const PASSWORD = 'Senha#Forte1';

describe('Conta do cliente final (integração com o banco)', () => {
  const prisma = new PrismaService();
  const jwt = new JwtService({ secret: SECRET });
  const config = {
    get: (key: string) =>
      ({ JWT_SECRET: SECRET, JWT_EXPIRATION: '3600', FRONTEND_URL: 'https://app.test' }[key]),
  };
  const sent: { template: string; to: string; context: Record<string, any>; lang: string }[] = [];
  const email = {
    sendCustomerEmail: async (
      _user: number | null,
      template: string,
      context: Record<string, any>,
      _subject: unknown,
      _meta: string,
      to: string,
      lang: string,
    ) => {
      sent.push({ template, to, context, lang });
    },
  };
  const service = new ClientAuthService(prisma, jwt, config as never, email as never);
  const guard = new GraphQLClientJwtAuthGuard(jwt, config as never, prisma);

  let ownerId: number;
  let networkId: number;
  let victimCustomerId: number;
  const victimEmail = `vitima-${RUN}@test.local`;
  const victimPhone = `+55129${RUN.slice(-8)}`;

  /** Último link enviado pra esse e-mail (token da query string). */
  const lastToken = (to: string, template: string) => {
    const mail = [...sent].reverse().find((m) => m.to === to && m.template === template);
    const url = String(mail?.context.VerifyURL ?? mail?.context.ResetURL ?? '');
    return new URL(url).searchParams.get('token')!;
  };

  /** Roda o guard com o cookie dessa conta; devolve se deixou passar. */
  const guardAccepts = async (account: { id: number; email: string; sessionVersion: number }) => {
    const cookies: Record<string, string> = {};
    service.issueCookie(account, {
      cookie: (name: string, value: string) => (cookies[name] = value),
    } as never);
    const req = { cookies };
    const ctx = {
      getType: () => 'graphql',
      getArgs: () => [{}, {}, { req }, {}],
      getClass: () => null,
      getHandler: () => null,
    };
    return guard.canActivate(ctx as never).then(
      () => true,
      () => false,
    );
  };

  const historyOf = (clientAccountId: number) => service.getHistory(clientAccountId);

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    ownerId = (
      await prisma.user.create({
        data: {
          email: `dono-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dono',
          idDocNumber: `cli${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId: role.id,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede ${RUN}` } })
    ).id;
    const shop = await prisma.barbershop.create({
      data: {
        name: `Unidade ${RUN}`,
        slug: `cli-${RUN}`,
        address: 'Rua Teste, 1',
        city: 'São Paulo',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `unidade-${RUN}@test.local`,
        networkId,
        ownerUserId: ownerId,
      },
    });
    // Ficha da vítima na barbearia, com uma venda paga
    victimCustomerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Vítima', email: victimEmail, phone: victimPhone },
      })
    ).id;
    await prisma.sale.create({
      data: {
        barbershopId: shop.id,
        customerId: victimCustomerId,
        saleType: 'SERVICE',
        subtotal: 80,
        total: 80,
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
      },
    });
  });

  afterAll(async () => {
    const accounts = await prisma.clientAccount.findMany({
      where: { email: { contains: RUN } },
      select: { id: true },
    });
    const ids = accounts.map((a) => a.id);
    await prisma.customer.updateMany({
      where: { clientAccountId: { in: ids } },
      data: { clientAccountId: null },
    });
    await prisma.clientLinkedSocialAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: ids } } });
    const shops = await prisma.barbershop.findMany({ where: { networkId }, select: { id: true } });
    await prisma.sale.deleteMany({ where: { barbershopId: { in: shops.map((s) => s.id) } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barbershop.deleteMany({ where: { networkId } });
    await prisma.network.delete({ where: { id: networkId } });
    await prisma.user.delete({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it('cadastro com o e-mail e o telefone de outra pessoa não mostra o histórico dela', async () => {
    const account = await service.signup(victimEmail, PASSWORD, 'Atacante', victimPhone, 'es');
    expect(await historyOf(account.id)).toEqual([]);
    const victim = await prisma.customer.findUnique({ where: { id: victimCustomerId } });
    expect(victim!.clientAccountId).toBeNull();

    // Login também não liga nada enquanto o e-mail não for confirmado
    await service.validateCredentials(victimEmail, PASSWORD);
    expect(await historyOf(account.id)).toEqual([]);

    // Link de confirmação foi pro e-mail (na língua do cadastro)
    const mail = sent.find((m) => m.to === victimEmail && m.template === 'verify_email');
    expect(mail?.lang).toBe('es');
    expect(mail?.context.VerifyURL).toMatch(/^https:\/\/app\.test\/client\/verify-email\?token=/);
    expect((await service.getById(account.id)).emailVerified).toBe(false);
  });

  it('confirmar o e-mail pelo link liga as fichas desse e-mail; o link vale uma vez só', async () => {
    const token = lastToken(victimEmail, 'verify_email');
    const account = await service.verifyEmail(token);
    expect(account.emailVerifiedAt).toBeTruthy();
    const history = await historyOf(account.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ type: 'SALE', total: 80 });

    await expect(service.verifyEmail(token)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.verifyEmail('token-inventado')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('esqueci a senha: não revela se a conta existe; o link troca a senha e derruba as sessões', async () => {
    const before = sent.length;
    await expect(
      service.requestPasswordReset(`ninguem-${RUN}@test.local`),
    ).resolves.toBeUndefined();
    expect(sent.length).toBe(before);

    const accountBefore = await prisma.clientAccount.findUniqueOrThrow({
      where: { email: victimEmail },
    });
    expect(await guardAccepts(accountBefore)).toBe(true);

    await service.requestPasswordReset(victimEmail.toUpperCase());
    const token = lastToken(victimEmail, 'password_reset');

    // Senha fraca é recusada e o link continua valendo
    await expect(service.resetPassword(token, 'fraca')).rejects.toBeInstanceOf(BadRequestException);

    await service.resetPassword(token, 'Outra#Senha2');
    await expect(service.validateCredentials(victimEmail, PASSWORD)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.validateCredentials(victimEmail, 'Outra#Senha2')).resolves.toBeTruthy();

    // Cookie emitido antes da troca não entra mais; um novo entra
    expect(await guardAccepts(accountBefore)).toBe(false);
    const accountAfter = await prisma.clientAccount.findUniqueOrThrow({
      where: { email: victimEmail },
    });
    expect(await guardAccepts(accountAfter)).toBe(true);

    // Link usado não serve de novo
    await expect(service.resetPassword(token, 'Mais#Uma3')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('pedir outro link invalida o anterior; link vencido não vale', async () => {
    await service.requestPasswordReset(victimEmail);
    const first = lastToken(victimEmail, 'password_reset');
    await service.requestPasswordReset(victimEmail);
    const second = lastToken(victimEmail, 'password_reset');
    await expect(service.resetPassword(first, 'Nova#Senha3')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await prisma.clientAccountToken.updateMany({
      where: { clientAccount: { email: victimEmail }, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(service.resetPassword(second, 'Nova#Senha3')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('redefinir a senha confirma o e-mail (quem tem o e-mail retoma a conta)', async () => {
    const other = `outra-${RUN}@test.local`;
    await service.signup(other, PASSWORD, 'Quem cadastrou');
    await service.requestPasswordReset(other);
    const account = await service.resetPassword(lastToken(other, 'password_reset'), 'Dona#Real4');
    expect(account.emailVerifiedAt).toBeTruthy();
  });

  it('login social com o e-mail de uma conta não confirmada: apaga a senha de quem cadastrou', async () => {
    const socialEmail = `social-${RUN}@test.local`;
    const squatted = await service.signup(socialEmail, PASSWORD, 'Quem cadastrou');
    expect(await guardAccepts(squatted)).toBe(true);

    const account = await service.findOrCreateSocialAccount(
      socialEmail,
      'Dono do e-mail',
      'google',
    );
    expect(account.id).toBe(squatted.id);
    expect(account.emailVerifiedAt).toBeTruthy();
    expect(account.password).toBeNull();
    await expect(service.validateCredentials(socialEmail, PASSWORD)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(await guardAccepts(squatted)).toBe(false);
  });
});
