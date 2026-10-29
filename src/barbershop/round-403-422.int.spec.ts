/**
 * Itens 403–422: senha e termos do convite, idade no cadastro, perfil,
 * textos do catálogo, assinatura da ficha e candidatura repetida.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../auth/users/users.service';
import { memoryRedis, presetSignupCode } from '../auth/signup-code.testing-spec';
import { BarbershopService } from './barbershop.service';
import { EmployeeInviteService } from './employee-invite.service';
import { JobOpeningService } from './job-opening.service';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { AccountLinkService } from '../client-auth/account-link.service';
import { UserResolver } from '../graphql/resolvers/user.resolver';
import { ADDRESS_REQUIRED_MESSAGE } from '../common/person';
import { TERMS_REQUIRED_MESSAGE } from '../common/terms';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

const addDays = (n: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  return new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
};

describe('itens 403-422', () => {
  const prisma = new PrismaService();
  const redis = memoryRedis();
  const sent: Array<{ to: string; code: string }> = [];
  const users = new UserService(
    prisma,
    {
      sendTemplateEmail: async () => undefined,
      sendCustomerEmail: async (
        _u: unknown,
        _t: string,
        ctx: { VerificationCode?: string },
        _s: unknown,
        _m: string,
        to: string,
      ) => void sent.push({ to, code: ctx.VerificationCode ?? '' }),
    } as never,
    {} as never,
    { get: () => undefined } as never,
    redis as never,
  );
  const stub = {} as never;
  const shops = new BarbershopService(
    prisma,
    users,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { notify: () => undefined } as never,
  );
  const inviteUrls: string[] = [];
  const invites = new EmployeeInviteService(
    prisma,
    {
      sendCustomerEmail: async (...args: unknown[]) =>
        void inviteUrls.push((args[2] as { InviteUrl: string }).InviteUrl),
    } as never,
    { get: () => 'https://app.test' } as never,
    shops,
    { notify: () => undefined } as never,
    { memberJoined: async () => undefined } as never,
  );
  const jobs = new JobOpeningService(
    prisma,
    shops,
    invites,
    { notifyUsers: () => undefined, notify: () => undefined } as never,
    { sendToUsers: async () => undefined } as never,
  );
  const clients = new ClientAuthService(
    prisma,
    stub,
    { get: () => undefined } as never,
    { sendCustomerEmail: async () => undefined } as never,
    stub,
    new AccountLinkService(prisma, { sendCustomerEmail: async () => undefined } as never),
    redis as never,
  );
  const profile = new UserResolver(users, prisma, stub);

  let roleId: number;
  let ownerId: number;
  let networkId: number;
  let shopId: number;
  let proId: number;

  const createUser = async (label: string) =>
    (
      await prisma.user.create({
        data: {
          email: `r403-${label}-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: `Pessoa ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `119${RUN.slice(-8)}`,
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    const employee = await prisma.role.findFirst({ where: { name: 'BarbershopEmployee' } });
    if (!employee) await prisma.role.create({ data: { name: 'BarbershopEmployee' } });
    ownerId = await createUser('owner');
    proId = await createUser('pro');
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede 403 ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: `Unidade 403 ${RUN}`,
          slug: `u403-${RUN}`,
          address: 'Rua 1',
          city: 'Cidade',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `u403-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          ownerUserId: ownerId,
          networkId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { jobOpening: { barbershopId: shopId } } });
    await prisma.jobOpening.deleteMany({ where: { barbershopId: shopId } });
    await prisma.consentForm.deleteMany({ where: { barbershopId: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.employeeInvite.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${RUN}@test.local` } } });
    await prisma.clientAccount.deleteMany({ where: { email: { contains: `-${RUN}@test.local` } } });
    await prisma.$disconnect();
  });

  it('convite: senha fraca e aceite sem termos são recusados', async () => {
    const email = `r403-convite-${RUN}@test.local`;
    const { invite } = await invites.createInvite(ownerId, {
      barbershopId: shopId,
      email,
      name: 'Convidada',
      phone: '11900004031',
      role: 'BarbershopEmployee',
    });
    const emailKey = new URL(inviteUrls[inviteUrls.length - 1]).searchParams.get('k') ?? '';
    const base = {
      fullName: 'Pessoa Convidada',
      idDocNumber: `8${RUN}`.slice(-11),
      phone: '11900004032',
      birthdate: '1995-05-05',
      gender: 'female',
      emailKey,
    };
    await expect(
      invites.acceptInvite(invite.inviteToken, { ...base, password: '1', readTerms: true }),
    ).rejects.toThrow();
    await expect(
      invites.acceptInvite(invite.inviteToken, {
        ...base,
        password: 'Equipe#2026',
        readTerms: false,
      }),
    ).rejects.toThrow(TERMS_REQUIRED_MESSAGE);
  });

  it('cadastro com 14 anos é recusado', async () => {
    const email = `r403-idade-${RUN}@test.local`;
    redis.store.delete(`auth:signup-code-sent:${email}`);
    await users.sendSignupCode(email);
    const emailCode = sent[sent.length - 1].code;
    await expect(
      users.createUser({
        email,
        emailCode,
        password: 'Senha@1234',
        fullName: 'Quatorze Anos',
        gender: 'male',
        phone: '11900004033',
        idDocNumber: `7${RUN}`.slice(-11),
        readTerms: true,
        birthdate: '2012-01-01',
        address: {
          zipcode: '12200000',
          street: 'Rua A',
          city: 'SJC',
          neighborhood: 'Centro',
          state: 'SP',
          country: 'BR',
        },
        userSystemConfig: { language: 'pt' },
      } as never),
    ).rejects.toThrow('16 anos');
  });

  it('minha conta recusa nome vazio, nascimento no futuro e cidade sem o resto do endereço', async () => {
    const user = { id: ownerId } as never;
    await expect(profile.updateUserProfile(user, { fullName: '  ' } as never)).rejects.toThrow(
      '2 letras',
    );
    await expect(
      profile.updateUserProfile(user, { birthdate: '2030-01-01' } as never),
    ).rejects.toThrow('nascimento');
    await expect(profile.updateUserProfile(user, { city: 'Campinas' } as never)).rejects.toThrow(
      ADDRESS_REQUIRED_MESSAGE,
    );
  });

  it('serviço sem nome e descrição enorme são recusados', async () => {
    await expect(
      shops.createService(ownerId, shopId, {
        name: '  ',
        durationMinutes: 30,
        price: 40,
        category: 'HAIR',
      } as never),
    ).rejects.toThrow('Informe o nome.');
    await expect(
      shops.createService(ownerId, shopId, {
        name: 'Corte',
        description: 'x'.repeat(10_000),
        durationMinutes: 30,
        price: 40,
        category: 'HAIR',
      } as never),
    ).rejects.toThrow('Texto muito longo');
  });

  it('ficha assinada pelo link é do cliente; no balcão fica quem registrou', async () => {
    const customer = await prisma.customer.create({
      data: { networkId, name: 'Cliente Ficha', phone: '11900004034' },
    });
    const form = await prisma.consentForm.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        formType: 'TERMS',
        answers: 'texto',
        signToken: `tok-${RUN}`,
      },
    });
    const byClient = await shops.signConsentByToken(form.signToken!, 'Cliente Ficha', '203.0.113.8');
    expect(byClient.signedVia).toBe('CLIENT');
    expect(byClient.signatureIp).toBe('203.0.113.8');
    expect(byClient.textVersion).toBeTruthy();
    const preview = await shops.consentByToken(form.signToken!);
    expect(preview).toMatchObject({ signedVia: 'CLIENT', shopName: `Unidade 403 ${RUN}` });
    expect(preview).not.toHaveProperty('answers');

    const other = await prisma.consentForm.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        formType: 'TERMS',
        signToken: `tok2-${RUN}`,
      },
    });
    const atCounter = await shops.signConsentForm(ownerId, shopId, other.id, 'Cliente Ficha');
    expect(atCounter.signedVia).toBe('COUNTER');
    expect(atCounter.recordedByName).toContain('Pessoa owner');
  });

  it('voltar à vaga não manda o segundo aviso; unidade suspensa não recebe candidatura', async () => {
    const opening = await jobs.create(ownerId, {
      barbershopId: shopId,
      title: 'Sábado',
      startDate: addDays(3),
      endDate: addDays(4),
    } as never);
    await jobs.apply(proId, opening.id);
    const first = await prisma.userNotification.count({
      where: { userId: ownerId, title: 'Nova candidatura' },
    });
    const row = await prisma.jobApplication.findFirstOrThrow({
      where: { jobOpeningId: opening.id, userId: proId },
    });
    await jobs.withdraw(proId, row.id);
    await jobs.apply(proId, opening.id);
    const second = await prisma.userNotification.count({
      where: { userId: ownerId, title: 'Nova candidatura' },
    });
    expect(second).toBe(first);
    await jobs.withdraw(proId, row.id);
    await expect(jobs.apply(proId, opening.id)).rejects.toThrow('já voltou');

    await prisma.barbershop.update({
      where: { id: shopId },
      data: { platformSuspendedAt: new Date() },
    });
    const other = await jobs.create(ownerId, {
      barbershopId: shopId,
      title: 'Suspensa',
      startDate: addDays(5),
      endDate: addDays(6),
    } as never);
    await expect(jobs.apply(proId, other.id)).rejects.toBeInstanceOf(NotFoundException);
    await prisma.barbershop.update({
      where: { id: shopId },
      data: { platformSuspendedAt: null },
    });
  });

  it('cadastro de cliente sem aceite dos termos é recusado', async () => {
    const email = `r403-cliente-${RUN}@test.local`;
    const code = presetSignupCode(redis, email);
    await expect(
      clients.signup(email, 'Senha#Forte1', 'Cliente Novo', '11900004035', 'pt', code),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      clients.signup(email, 'Senha#Forte1', 'Cliente Novo', '11900004035', 'pt', code, true),
    ).resolves.toMatchObject({ email });
  });
});
