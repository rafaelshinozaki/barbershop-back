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

  const signup = (roleName?: string) => {
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
});
