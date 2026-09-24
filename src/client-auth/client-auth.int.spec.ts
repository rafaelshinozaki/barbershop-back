/**
 * Conta do cliente final contra o Postgres de verdade (e-mail simulado).
 *
 * Antes, cadastrar a conta com o e-mail (ou o telefone) de outra pessoa ligava
 * as fichas dela em todas as barbearias à conta nova — dava pra ver onde,
 * quando e quanto ela gastou. Agora só o e-mail confirmado pelo link liga.
 */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  const stripeCalls: string[] = [];
  const stripe = {
    cancelSubscription: async (id: string) => void stripeCalls.push(`cancel:${id}`),
    deleteCustomer: async (id: string) => void stripeCalls.push(`delete:${id}`),
  };
  const service = new ClientAuthService(
    prisma,
    jwt,
    config as never,
    email as never,
    stripe as never,
  );
  // Contas excluídas mudam de e-mail (não batem mais com RUN na limpeza)
  const deletedIds: number[] = [];
  let shopId: number;
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
    shopId = shop.id;
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
    const ids = [...accounts.map((a) => a.id), ...deletedIds];
    await prisma.review.deleteMany({ where: { clientAccountId: { in: ids } } });
    await prisma.clientSubscription.deleteMany({ where: { clientAccountId: { in: ids } } });
    await prisma.customer.updateMany({
      where: { clientAccountId: { in: ids } },
      data: { clientAccountId: null },
    });
    await prisma.clientLinkedSocialAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: ids } } });
    const shops = await prisma.barbershop.findMany({ where: { networkId }, select: { id: true } });
    await prisma.sale.deleteMany({ where: { barbershopId: { in: shops.map((s) => s.id) } } });
    await prisma.clientSubscriptionPlan.deleteMany({
      where: { barbershopId: { in: shops.map((s) => s.id) } },
    });
    await prisma.barbershopService.deleteMany({
      where: { barbershopId: { in: shops.map((s) => s.id) } },
    });
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

  describe('exclusão da conta (LGPD)', () => {
    it('senha errada não apaga; certa cancela cobranças, apaga dados pessoais e libera o e-mail', async () => {
      const mail = `apagar-${RUN}@test.local`;
      const account = await service.signup(mail, PASSWORD, 'Quem sai', '+5511900000000');
      deletedIds.push(account.id);
      await prisma.clientAccount.update({
        where: { id: account.id },
        data: { emailVerifiedAt: new Date(), stripeCustomerId: `cus_cli_${RUN}` },
      });
      // Ficha na barbearia ligada, favorito, avaliação e assinatura de serviço
      const customer = await prisma.customer.create({
        data: { networkId, name: 'Quem sai', email: mail, clientAccountId: account.id, phone: '1' },
      });
      await prisma.clientFavorite.create({ data: { clientAccountId: account.id, networkId } });
      await prisma.review.create({
        data: { barbershopId: shopId, clientAccountId: account.id, rating: 5, comment: 'Ótimo' },
      });
      const svc = await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: 50 },
      });
      const plan = await prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: shopId,
          serviceId: svc.id,
          name: 'Mensal',
          price: new Prisma.Decimal(80),
        },
      });
      const sub = await prisma.clientSubscription.create({
        data: {
          barbershopId: shopId,
          clientAccountId: account.id,
          planId: plan.id,
          stripeSubscriptionId: `sub_cli_${RUN}`,
          status: 'ACTIVE',
        },
      });
      await prisma.clientSubscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          stripeInvoiceId: `in_${RUN}`,
          amount: 80,
          status: 'SUCCEEDED',
        },
      });
      const fresh = await prisma.clientAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(await guardAccepts(fresh)).toBe(true);

      await expect(
        service.deleteAccount(account.id, { password: 'errada' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stripeCalls).toEqual([]);

      await service.deleteAccount(account.id, { password: PASSWORD });
      expect(stripeCalls).toEqual([`cancel:sub_cli_${RUN}`, `delete:cus_cli_${RUN}`]);

      const after = await prisma.clientAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(after).toMatchObject({
        email: `excluida-${account.id}@conta-excluida.invalid`,
        name: 'Conta excluída',
        phone: null,
        password: null,
        stripeCustomerId: null,
      });
      expect(after.deletedAt).toBeTruthy();
      expect(await guardAccepts(fresh)).toBe(false);
      expect(await prisma.review.count({ where: { clientAccountId: account.id } })).toBe(0);
      expect(await prisma.clientFavorite.count({ where: { clientAccountId: account.id } })).toBe(0);
      // A ficha continua na barbearia (é registro dela), só desligada
      expect(
        (await prisma.customer.findUnique({ where: { id: customer.id } }))!.clientAccountId,
      ).toBeNull();
      // Assinatura cancelada; o pagamento que a barbearia recebeu fica
      expect((await prisma.clientSubscription.findUnique({ where: { id: sub.id } }))!.status).toBe(
        'CANCELED',
      );
      expect(
        await prisma.clientSubscriptionPayment.count({ where: { subscriptionId: sub.id } }),
      ).toBe(1);
      // E-mail liberado pra uma conta nova
      const again = await service.signup(mail, PASSWORD, 'Voltou');
      expect(again.id).not.toBe(account.id);
    });

    it('conta só de login social confirma digitando o e-mail', async () => {
      const mail = `social-apagar-${RUN}@test.local`;
      const account = await service.findOrCreateSocialAccount(mail, 'Social', 'google');
      deletedIds.push(account.id);
      expect((await service.getById(account.id)).hasPassword).toBe(false);
      await expect(
        service.deleteAccount(account.id, { email: 'outro@x.com' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await service.deleteAccount(account.id, { email: mail.toUpperCase() });
      await expect(service.getById(account.id)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(
        await prisma.clientLinkedSocialAccount.count({ where: { clientAccountId: account.id } }),
      ).toBe(0);
    });
  });
});
