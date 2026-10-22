/**
 * Cadastro público, contra o Postgres de verdade: o cargo pedido no corpo da
 * requisição só vale se for dono ou profissional. Antes, o POST /user/create
 * aceitava "roleName": "SystemAdmin" e criava um admin do sistema.
 */
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../interfaces/roles';
import { UserService } from './users.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Cadastro: cargo (integração)', () => {
  const prisma = new PrismaService();
  const service = new UserService(
    prisma,
    { sendTemplateEmail: async () => undefined } as never,
    {} as never,
    { get: () => undefined } as never,
    { client: { exists: async () => 0 } } as never,
  );
  let n = 0;

  const signup = (roleName?: string, over: Record<string, unknown> = {}) => {
    n++;
    return service.createUser({
      email: `role-${n}-${RUN}@test.local`,
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
});
