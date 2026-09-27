import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AccountLinkService } from './account-link.service';
import { ClientAuthService } from './client-auth.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const STAFF_PASSWORD = 'Equipe#Forte1';
const CLIENT_PASSWORD = 'Cliente#Forte2';

/**
 * Uma pessoa, duas telas: a conta de cliente e a da equipe com o mesmo
 * e-mail se ligam só com prova (a senha dos dois lados), e ligadas a senha
 * da equipe vale nas duas.
 */
describe('Ligação entre conta de cliente e conta da equipe (integração)', () => {
  const prisma = new PrismaService();
  const jwt = new JwtService({ secret: 'segredo-de-teste' });
  const config = {
    get: (key: string) =>
      ({ JWT_SECRET: 'segredo-de-teste', JWT_EXPIRATION: '3600', FRONTEND_URL: 'https://app.test' }[
        key
      ]),
  };
  const sent: { template: string; to: string; context: Record<string, any> }[] = [];
  const email = {
    sendCustomerEmail: async (
      _user: number | null,
      template: string,
      context: Record<string, any>,
      _subject: unknown,
      _meta: string,
      to: string,
    ) => void sent.push({ template, to, context }),
  };
  const link = new AccountLinkService(prisma, email as never);
  const clients = new ClientAuthService(
    prisma,
    jwt,
    config as never,
    email as never,
    {} as never,
    link,
  );

  let roleId: number;
  const userIds: number[] = [];
  const mail = (label: string) => `ligar-${label}-${RUN}@test.local`;
  const lastToken = (to: string, template: string) => {
    const m = [...sent].reverse().find((x) => x.to === to && x.template === template);
    const url = String(m?.context.VerifyURL ?? m?.context.ResetURL ?? '');
    return new URL(url).searchParams.get('token')!;
  };

  const staff = async (label: string, extra: { twoFactorEnabled?: boolean } = {}) => {
    const u = await prisma.user.create({
      data: {
        // Maiúsculas: o cadastro da equipe guarda o e-mail como digitado
        email: mail(label).replace('ligar', 'Ligar'),
        password: await bcrypt.hash(STAFF_PASSWORD, 10),
        fullName: `Profissional ${label}`,
        idDocNumber: `lk${label}${RUN}`.slice(-20),
        phone: `+5511${RUN}`.slice(0, 20),
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
    await prisma.clientAccountToken.deleteMany({
      where: { clientAccount: { email: { contains: RUN } } },
    });
    await prisma.clientAccount.deleteMany({ where: { email: { contains: RUN } } });
    await prisma.activeSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('só equipe: entra na área do cliente com a senha da equipe e a conta nasce ligada', async () => {
    const u = await staff('so-equipe');
    await expect(
      clients.validateCredentials(mail('so-equipe'), 'Errada#123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const account = await clients.validateCredentials(mail('so-equipe'), STAFF_PASSWORD);
    expect(account).toMatchObject({
      email: mail('so-equipe'),
      name: 'Profissional so-equipe',
      userId: u.id,
      password: null,
      // E-mail da equipe nunca foi confirmado: histórico só depois de confirmar
      emailVerifiedAt: null,
    });
    expect(sent.some((m) => m.to === mail('so-equipe') && m.template === 'verify_email')).toBe(
      true,
    );
    // Entra de novo pela mesma senha
    expect((await clients.validateCredentials(mail('so-equipe'), STAFF_PASSWORD)).id).toBe(
      account.id,
    );
  });

  it('as duas com a mesma senha: o login liga e avisa por e-mail', async () => {
    const u = await staff('mesma');
    await clients.signup(mail('mesma-antes'), STAFF_PASSWORD, 'Outra'); // outro e-mail: não liga
    await prisma.clientAccount.create({
      data: {
        email: mail('mesma'),
        name: 'Cliente',
        password: await bcrypt.hash(STAFF_PASSWORD, 10),
      },
    });
    const account = await clients.validateCredentials(mail('mesma'), STAFF_PASSWORD);
    expect(account).toMatchObject({ userId: u.id, password: null });
    expect(sent.some((m) => m.to === mail('mesma') && m.template === 'accounts_linked')).toBe(true);
  });

  it('cadastro de cliente com a senha da equipe já nasce ligado; com outra, não', async () => {
    const u = await staff('cadastro');
    const linked = await clients.signup(mail('cadastro'), STAFF_PASSWORD, 'Cliente');
    expect(linked).toMatchObject({ userId: u.id, password: null });

    await staff('cadastro-outra');
    const loose = await clients.signup(mail('cadastro-outra'), CLIENT_PASSWORD, 'Cliente');
    expect(loose.userId).toBeNull();
  });

  it('senhas diferentes: liga pela área do cliente digitando a senha da equipe', async () => {
    const u = await staff('diferente');
    const account = await clients.signup(mail('diferente'), CLIENT_PASSWORD, 'Cliente');
    await clients.validateCredentials(mail('diferente'), CLIENT_PASSWORD);
    expect(
      (await prisma.clientAccount.findUnique({ where: { id: account.id } }))!.userId,
    ).toBeNull();

    // Sem e-mail confirmado não conta que existe conta da equipe
    expect(await link.statusForClient(account.id)).toMatchObject({ linked: false, canLink: false });
    await clients.verifyEmail(lastToken(mail('diferente'), 'verify_email'));
    expect(await link.statusForClient(account.id)).toMatchObject({ linked: false, canLink: true });

    await expect(link.linkFromClient(account.id, CLIENT_PASSWORD)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const linked = await link.linkFromClient(account.id, STAFF_PASSWORD);
    expect(linked).toMatchObject({ userId: u.id, password: null });
    // Sessões antigas da área do cliente caem
    expect(linked.sessionVersion).toBeGreaterThan(account.sessionVersion);

    // Agora vale a senha da equipe nas duas telas
    await expect(
      clients.validateCredentials(mail('diferente'), CLIENT_PASSWORD),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect((await clients.validateCredentials(mail('diferente'), STAFF_PASSWORD)).id).toBe(
      account.id,
    );
    expect(await link.statusForClient(account.id)).toMatchObject({
      linked: true,
      canOpenOtherArea: true,
    });
    expect(await clients.getById(account.id)).toMatchObject({
      hasPassword: true,
      linkedToStaff: true,
    });
  });

  it('pela equipe: liga digitando a senha da conta de cliente', async () => {
    const u = await staff('pela-equipe');
    await clients.signup(mail('pela-equipe'), CLIENT_PASSWORD, 'Cliente');
    expect(await link.statusForStaff(u.id)).toEqual({
      linked: false,
      canLink: true,
      clientHasPassword: true,
    });
    await expect(link.linkFromStaff(u.id, STAFF_PASSWORD)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await link.linkFromStaff(u.id, CLIENT_PASSWORD);
    expect((await link.statusForStaff(u.id)).linked).toBe(true);
    // Já ligada: abrir a área do cliente entra nela
    const { account, created } = await link.clientAccountForStaff(u.id);
    expect(created).toBe(false);
    expect(account.userId).toBe(u.id);
  });

  it('equipe sem conta de cliente: abrir a área do cliente cria uma já ligada', async () => {
    const u = await staff('abre');
    const { account, created } = await link.clientAccountForStaff(u.id);
    expect(created).toBe(true);
    expect(account).toMatchObject({ email: mail('abre'), userId: u.id, emailVerifiedAt: null });

    // Conta de cliente solta com o mesmo e-mail: precisa ligar antes
    const other = await staff('abre-solta');
    await clients.signup(mail('abre-solta'), CLIENT_PASSWORD, 'Cliente');
    await expect(link.clientAccountForStaff(other.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('esqueci a senha na área do cliente ligada troca a senha da equipe e derruba as sessões', async () => {
    const u = await staff('reset');
    const account = await clients.signup(mail('reset'), STAFF_PASSWORD, 'Cliente');
    await prisma.activeSession.create({
      data: {
        userId: u.id,
        sessionToken: `s-${RUN}`,
        deviceType: 'Desktop',
        browser: 'x',
        os: 'x',
        ip: '1.1.1.1',
        location: 'Teste',
      },
    });
    await clients.requestPasswordReset(mail('reset'));
    await new Promise((r) => setTimeout(r, 50));
    await clients.resetPassword(lastToken(mail('reset'), 'password_reset'), 'Nova#Senha9');

    const user = await prisma.user.findUnique({ where: { id: u.id } });
    expect(await bcrypt.compare('Nova#Senha9', user!.password)).toBe(true);
    expect(await prisma.activeSession.count({ where: { userId: u.id } })).toBe(0);
    const after = await prisma.clientAccount.findUnique({ where: { id: account.id } });
    expect(after).toMatchObject({ password: null, userId: u.id });
    expect((await clients.validateCredentials(mail('reset'), 'Nova#Senha9')).id).toBe(account.id);
  });

  it('abrir a área da equipe pela do cliente: não com verificação em duas etapas', async () => {
    const u = await staff('2fa', { twoFactorEnabled: true });
    const account = await clients.signup(mail('2fa'), STAFF_PASSWORD, 'Cliente');
    expect(account.userId).toBe(u.id);
    expect(await link.statusForClient(account.id)).toMatchObject({
      linked: true,
      canOpenOtherArea: false,
    });
    await expect(link.staffForClient(account.id)).rejects.toBeInstanceOf(BadRequestException);

    const solta = await clients.signup(mail('sem-equipe'), CLIENT_PASSWORD, 'Cliente');
    await expect(link.staffForClient(solta.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('excluir a conta de cliente ligada: confirma com a senha da equipe e a equipe fica', async () => {
    const u = await staff('exclui');
    const account = await clients.signup(mail('exclui'), STAFF_PASSWORD, 'Cliente');
    await expect(
      clients.deleteAccount(account.id, { password: CLIENT_PASSWORD }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await clients.deleteAccount(account.id, { password: STAFF_PASSWORD });
    const deleted = await prisma.clientAccount.findUnique({ where: { id: account.id } });
    expect(deleted).toMatchObject({ userId: null, deletedAt: expect.any(Date) });
    expect(await prisma.user.findUnique({ where: { id: u.id } })).toMatchObject({ isActive: true });
    // O e-mail volta a ficar livre: entrar de novo cria uma conta nova ligada
    await prisma.clientAccount.update({
      where: { id: account.id },
      data: { email: mail('exclui-x') },
    });
    expect((await clients.validateCredentials(mail('exclui'), STAFF_PASSWORD)).userId).toBe(u.id);
  });
});
