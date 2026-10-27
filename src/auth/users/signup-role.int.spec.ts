/**
 * Cadastro público, contra o Postgres de verdade: o cargo pedido no corpo da
 * requisição só vale se for dono ou profissional. Antes, o POST /user/create
 * aceitava "roleName": "SystemAdmin" e criava um admin do sistema.
 */
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../interfaces/roles';
import { UserService } from './users.service';
import { memoryRedis } from '../signup-code.testing-spec';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Cadastro: cargo (integração)', () => {
  const prisma = new PrismaService();
  const redis = memoryRedis();
  const sent: Array<{ to: string; code: string }> = [];
  const service = new UserService(
    prisma,
    {
      sendTemplateEmail: async () => undefined,
      sendCustomerEmail: async (
        _u: unknown,
        _t: string,
        ctx: { VerificationCode: string },
        _s: unknown,
        _m: string,
        to: string,
      ) => void sent.push({ to, code: ctx.VerificationCode }),
    } as never,
    {} as never,
    { get: () => undefined } as never,
    redis as never,
  );
  let n = 0;

  // Cadastro completo: pede o código e usa o que chegou no e-mail
  const codeFor = async (email: string) => {
    redis.store.delete(`auth:signup-code-sent:${email}`);
    await service.sendSignupCode(email);
    return sent[sent.length - 1].code;
  };

  const signup = async (roleName?: string, over: Record<string, unknown> = {}) => {
    n++;
    const email = `role-${n}-${RUN}@test.local`;
    return service.createUser({
      email,
      emailCode: await codeFor(email),
      password: 'Senha@1234',
      fullName: 'Teste Cargo',
      gender: 'male',
      phone: `+5512${RUN}${n}`.slice(0, 20),
      idDocNumber: `${RUN}${n}`.slice(-20),
      readTerms: true,
      // Só a data (como o formulário manda): não pode quebrar o cadastro
      birthdate: '1990-01-01' as never,
      address: {
        zipcode: '12200000',
        street: 'Rua A',
        city: 'SJC',
        neighborhood: 'Centro',
        state: 'SP',
        country: 'BR',
      },
      userSystemConfig: { language: 'pt' },
      ...(roleName ? { roleName } : {}),
      ...over,
    } as never);
  };
  const roleOf = async (email: string) =>
    (
      await prisma.user.findFirstOrThrow({
        where: { email },
        include: { role: true },
      })
    ).role.name;

  beforeAll(async () => {
    for (const name of [Role.BARBERSHOP_OWNER, Role.BARBERSHOP_EMPLOYEE, Role.SYSTEM_ADMIN]) {
      if (!(await prisma.role.findFirst({ where: { name } }))) {
        await prisma.role.create({ data: { name } });
      }
    }
  });

  afterAll(async () => {
    const where = { user: { email: { endsWith: `-${RUN}@test.local` } } };
    await prisma.userSystemConfig.deleteMany({ where });
    await prisma.address.deleteMany({ where });
    await prisma.notificationPreference.deleteMany({ where });
    await prisma.payment.deleteMany({ where: { subscription: where } });
    await prisma.passwordResetToken.deleteMany({ where });
    await prisma.subscription.deleteMany({ where });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('pedir admin/gerente do sistema cria dono (o cargo padrão)', async () => {
    for (const asked of [Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER]) {
      await signup(asked);
      expect(await roleOf(`role-${n}-${RUN}@test.local`)).toBe(Role.BARBERSHOP_OWNER);
    }
  });

  it('dono e profissional continuam valendo', async () => {
    await signup(Role.BARBERSHOP_EMPLOYEE);
    expect(await roleOf(`role-${n}-${RUN}@test.local`)).toBe(Role.BARBERSHOP_EMPLOYEE);
    await signup();
    expect(await roleOf(`role-${n}-${RUN}@test.local`)).toBe(Role.BARBERSHOP_OWNER);
  });

  it('senha fraca e cadastro sem aceitar os termos são recusados; o aceite fica com a data (item 257)', async () => {
    await expect(signup(undefined, { password: '1' })).rejects.toThrow(
      'Password does not meet the complexity requirements.',
    );
    await expect(signup(undefined, { readTerms: false })).rejects.toThrow(
      'Aceite os termos de uso',
    );
    const created = await signup();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.readTerms).toBe(true);
    expect(row.termsAcceptedAt).not.toBeNull();
  });

  it('cadastro com senha só cria a conta com o código do e-mail, e a conta nasce confirmada', async () => {
    const email = `code-${RUN}@test.local`;
    const base = {
      email,
      password: 'Senha@1234',
      fullName: 'Teste Codigo',
      gender: 'male',
      phone: `+5514${RUN}`.slice(0, 20),
      idDocNumber: `cod${RUN}`.slice(-20),
      readTerms: true,
      birthdate: '1990-01-01',
      userSystemConfig: { language: 'pt' },
    };
    const exists = () => prisma.user.count({ where: { email } });

    // Sem código, ou com código de outro e-mail: nada é criado
    await expect(service.createUser(base as never)).rejects.toThrow('verification code');
    const other = await codeFor(`outro-${RUN}@test.local`);
    await expect(service.createUser({ ...base, emailCode: other } as never)).rejects.toThrow(
      'verification code',
    );
    expect(await exists()).toBe(0);

    // Pedir de novo logo em seguida espera um minuto
    await service.sendSignupCode(email);
    await expect(service.sendSignupCode(email)).rejects.toThrow('Wait a minute');
    const code = sent[sent.length - 1].code;
    expect(sent[sent.length - 1].to).toBe(email);

    // Erro de validação (senha fraca) não queima o código
    await expect(
      service.createUser({ ...base, emailCode: code, password: '1' } as never),
    ).rejects.toThrow('complexity');
    const created = await service.createUser({ ...base, emailCode: code } as never);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.emailVerifiedAt).not.toBeNull();

    // Uso único
    await expect(service.createUser({ ...base, emailCode: code } as never)).rejects.toThrow(
      'verification code',
    );
  });

  it('código errado conta tentativas e, no limite, o código certo também deixa de valer', async () => {
    const email = `tries-${RUN}@test.local`;
    const code = await codeFor(email);
    const wrong = code === '111111' ? '222222' : '111111';
    const attempt = (c: string) =>
      service.createUser({
        email,
        emailCode: c,
        password: 'Senha@1234',
        fullName: 'Teste Tentativa',
        gender: 'male',
        phone: `+5515${RUN}`.slice(0, 20),
        idDocNumber: `try${RUN}`.slice(-20),
        readTerms: true,
        birthdate: '1990-01-01',
        userSystemConfig: { language: 'pt' },
      } as never);
    for (let i = 0; i < 6; i++) await expect(attempt(wrong)).rejects.toThrow('verification code');
    await expect(attempt(code)).rejects.toThrow('verification code');
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('e-mail já cadastrado: sem o código, a resposta não diz que a conta existe', async () => {
    await signup();
    const email = `role-${n}-${RUN}@test.local`;
    await expect(
      service.createUser({
        email,
        emailCode: '000000',
        password: 'Senha@1234',
        fullName: 'Outra Pessoa',
        gender: 'male',
        phone: '+5512999999999',
        idDocNumber: '',
        readTerms: true,
        birthdate: '1990-01-01',
      } as never),
    ).rejects.toThrow('verification code');
    // Com o código (quem tem a caixa de entrada), aí sim o duplicado aparece
    await expect(
      service.createUser({
        email,
        emailCode: await codeFor(email),
        password: 'Senha@1234',
        fullName: 'Outra Pessoa',
        gender: 'male',
        phone: '+5512999999999',
        idDocNumber: '',
        readTerms: true,
        birthdate: '1990-01-01',
      } as never),
    ).rejects.toThrow('Registration data already in use');
  });

  it('importação pela planilha: sem a senha, o aceite e o plano pago da planilha (item 256)', async () => {
    const email = `import-${RUN}@test.local`;
    const result = await service.importUsersFromCsv([
      {
        email,
        password: 'qualquer',
        fullName: 'Importada',
        gender: 'female',
        phone: `+5513${RUN}`.slice(0, 20),
        idDocNumber: `imp${RUN}`.slice(-20),
        birthdate: '1990-01-01',
        readTerms: true,
        membership: 'PAID',
        isActive: 'true',
        address: {
          zipcode: '12200000',
          street: 'Rua A',
          city: 'SJC',
          neighborhood: 'Centro',
          state: 'SP',
          country: 'BR',
        },
        userSystemConfig: { language: 'pt' },
      },
    ]);
    expect(result.successCount).toBe(1);
    const user = await prisma.user.findFirstOrThrow({
      where: { email },
      include: { subscriptions: { include: { plan: true } } },
    });
    expect(user.readTerms).toBe(false);
    expect(user.membership).toBe('FREE');
    expect(user.subscriptions).toHaveLength(1);
    expect(user.subscriptions[0].status).toBe('ACTIVE');
    expect(Number(user.subscriptions[0].plan.price)).toBe(0);
    // A senha da planilha não entra; a pessoa recebe o link para criar a dela
    await expect(service.verifyUser(email, 'qualquer')).rejects.toThrow();
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);

    await service.acceptTerms(user.id);
    const accepted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(accepted.readTerms).toBe(true);
    expect(accepted.termsAcceptedAt).not.toBeNull();
  });
  describe('login social da equipe (itens 270 e 271)', () => {
    const local = (label: string, over: Record<string, unknown> = {}) =>
      prisma.user.create({
        data: {
          email: `social-${label}-${RUN}@test.local`,
          password: 'hash-de-quem-criou',
          fullName: `Social ${label}`,
          idDocNumber: `s${label}${RUN}`.slice(-20),
          phone: `+5513${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
          roleId: undefined as never,
          ...over,
        } as never,
      });
    let roleId: number;
    beforeAll(async () => {
      roleId = (
        (await prisma.role.findFirst({ where: { name: Role.BARBERSHOP_OWNER } })) ??
        (await prisma.role.create({ data: { name: Role.BARBERSHOP_OWNER } }))
      ).id;
    });

    it('270: conta desativada não entra pelo Google', async () => {
      const off = await local('off', { roleId, isActive: false });
      await expect(
        service.findOrCreateSocialUser(off.email, 'Off', 'google', `g-off-${RUN}`),
      ).rejects.toThrow('Invalid credentials');
    });

    it('271: e-mail nunca confirmado — a senha de quem criou sai, e as sessões também', async () => {
      const taken = await local('taken', { roleId });
      await prisma.activeSession.create({
        data: {
          userId: taken.id,
          sessionToken: `s-taken-${RUN}`,
          deviceType: 'd',
          browser: 'b',
          os: 'o',
          ip: 'i',
          location: 'l',
        },
      });
      const user = await service.findOrCreateSocialUser(
        taken.email,
        'Dona',
        'google',
        `g-dona-${RUN}`,
      );
      expect(user.id).toBe(taken.id);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: taken.id } });
      expect(after.password).not.toBe('hash-de-quem-criou');
      expect(after.emailVerifiedAt).toBeInstanceOf(Date);
      expect(await prisma.activeSession.count({ where: { userId: taken.id } })).toBe(0);

      // O próximo login acha a conta pelo id do Google, mesmo com outro e-mail
      const again = await service.findOrCreateSocialUser(
        `outro-${RUN}@test.local`,
        'Dona',
        'google',
        `g-dona-${RUN}`,
      );
      expect(again.id).toBe(taken.id);
    });

    it('271: conta com e-mail confirmado não perde a senha', async () => {
      const ok = await local('ok', { roleId, emailVerifiedAt: new Date() });
      await service.findOrCreateSocialUser(ok.email, 'Ok', 'facebook', `f-ok-${RUN}`);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ok.id } })).password).toBe(
        'hash-de-quem-criou',
      );
    });
  });
});
