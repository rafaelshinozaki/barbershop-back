/**
 * Seletor de pessoas de Avisos e E-mails (área Operação) contra o banco: só
 * nome, cargo, plano e se está ativa; contas do sistema ficam fora.
 */
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../auth/interfaces/roles';
import type { EmailService } from '../email/email.service';
import { BackofficeService } from './backoffice.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TAG = `Pessoa${RUN}`;

describe('seletor de pessoas do backoffice (integração)', () => {
  const prisma = new PrismaService();
  const service = new BackofficeService(prisma, {} as EmailService);

  const roleId = async (name: string) =>
    (
      (await prisma.role.findFirst({ where: { name } })) ??
      (await prisma.role.create({ data: { name } }))
    ).id;
  const createUser = async (key: string, role: Role) =>
    prisma.user.create({
      data: {
        email: `people-${key}-${RUN}@test.local`,
        password: 'x',
        fullName: `${TAG} ${key}`,
        idDocNumber: `${RUN}${key}`.slice(-20),
        phone: `+5511${RUN}`.slice(0, 20),
        gender: 'male',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId: await roleId(role),
      },
    });

  beforeAll(async () => {
    await createUser('dono', Role.BARBERSHOP_OWNER);
    await createUser('equipe', Role.BARBERSHOP_EMPLOYEE);
    await createUser('sistema', Role.SYSTEM_MANAGER);
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('busca pelo nome (sem diferenciar maiúscula) e deixa as contas do sistema de fora', async () => {
    const result = await service.listPeople({ name: TAG.toLowerCase() });
    expect(result.total).toBe(2);
    expect(result.data.map((p) => p.fullName).sort()).toEqual([`${TAG} dono`, `${TAG} equipe`]);
    // Nada de contato nem endereço
    for (const person of result.data) {
      expect(Object.keys(person).sort()).toEqual(['fullName', 'id', 'isActive', 'plan', 'role']);
    }
  });

  it('filtra pelo cargo e limita o tamanho da página', async () => {
    const owners = await service.listPeople({ name: TAG, role: Role.BARBERSHOP_OWNER });
    expect(owners.data.map((p) => p.role)).toEqual([Role.BARBERSHOP_OWNER]);
    // Pedir uma conta do sistema pelo cargo não traz nada
    expect((await service.listPeople({ name: TAG, role: Role.SYSTEM_MANAGER })).total).toBe(0);
    const page = await service.listPeople({ name: TAG, limit: 1000 });
    expect(page.data.length).toBeLessThanOrEqual(50);
  });
});
