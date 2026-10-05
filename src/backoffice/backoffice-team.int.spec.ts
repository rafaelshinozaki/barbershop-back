/**
 * Equipe do sistema contra o banco de verdade: áreas do backoffice no guard,
 * o admin liberando áreas e a equipe sem poder mexer em conta do sistema.
 */
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../auth/interfaces/roles';
import { BACKOFFICE_AREA_KEY, BackofficeArea } from '../auth/backoffice-areas';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserService } from '../auth/users/users.service';
import { BackofficeTeamService } from './backoffice-team.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const SECRET = 'segredo-dos-testes';

describe('equipe do sistema e áreas do backoffice (integração)', () => {
  const prisma = new PrismaService();
  const jwt = new JwtService({ secret: SECRET });
  const team = new BackofficeTeamService(prisma);
  // Só o que o teste usa do UserService (o resto das dependências fica de fora)
  const users = Object.assign(Object.create(UserService.prototype), { prisma }) as UserService;
  const ids: Record<string, number> = {};
  const sessions: Record<string, string> = {};

  const roleId = async (name: string) =>
    (
      (await prisma.role.findFirst({ where: { name } })) ??
      (await prisma.role.create({ data: { name } }))
    ).id;

  const createUser = async (key: string, role: Role, backofficeAreas: string[] = []) => {
    ids[key] = (
      await prisma.user.create({
        data: {
          email: `team-${key}-${RUN}@test.local`,
          password: 'x',
          fullName: `Equipe ${key}`,
          idDocNumber: `${RUN}${key}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
          roleId: await roleId(role),
          backofficeAreas,
        },
      })
    ).id;
    // Sessão de verdade: o guard exige a ActiveSession do token
    sessions[key] = `team-${key}-${RUN}`;
    await prisma.activeSession.create({
      data: {
        userId: ids[key],
        sessionToken: sessions[key],
        deviceType: 'desktop',
        browser: 'test',
        os: 'test',
        ip: '127.0.0.1',
        location: 'test',
      },
    });
  };

  beforeAll(async () => {
    await createUser('admin', Role.SYSTEM_ADMIN);
    await createUser('suporte', Role.SYSTEM_MANAGER, [BackofficeArea.SUPPORT]);
    await createUser('semarea', Role.SYSTEM_MANAGER);
    await createUser('dono', Role.BARBERSHOP_OWNER);
  });

  afterAll(async () => {
    await prisma.activeSession.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  /** Chama o guard como se a operação exigisse estes cargos e esta área. */
  const canActivate = (userKey: string, roles: Role[], area?: BackofficeArea) => {
    const guard = new RolesGuard(
      {
        getAllAndOverride: (key: string) => (key === BACKOFFICE_AREA_KEY ? area : roles),
      } as never,
      prisma,
      jwt,
      { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) } as never,
    );
    const token = jwt.sign({ userId: ids[userKey], sessionToken: sessions[userKey] });
    const req = { headers: {}, cookies: { Authentication: token } };
    const context = {
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context);
  };
  const STAFF = [Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER];

  it('equipe só entra nas áreas liberadas; o admin entra em todas', async () => {
    await expect(canActivate('suporte', STAFF, BackofficeArea.SUPPORT)).resolves.toBe(true);
    await expect(canActivate('suporte', STAFF, BackofficeArea.FINANCE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(canActivate('semarea', STAFF, BackofficeArea.SUPPORT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(canActivate('admin', STAFF, BackofficeArea.FINANCE)).resolves.toBe(true);
  });

  it('operação da equipe sem área marcada recusa a equipe (e não o admin)', async () => {
    await expect(canActivate('suporte', STAFF)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(canActivate('admin', STAFF)).resolves.toBe(true);
  });

  it('o admin libera e tira áreas; só vale para a equipe', async () => {
    await expect(
      team.setAreas(ids.semarea, [BackofficeArea.MODERATION, 'support', 'moderation']),
    ).resolves.toEqual(['support', 'moderation']);
    await expect(canActivate('semarea', STAFF, BackofficeArea.MODERATION)).resolves.toBe(true);

    await expect(team.setAreas(ids.semarea, ['dinheiro'])).rejects.toThrow('Área desconhecida');
    await expect(team.setAreas(ids.dono, ['support'])).rejects.toThrow('equipe do sistema');

    await team.setAreas(ids.semarea, []);
    await expect(canActivate('semarea', STAFF, BackofficeArea.MODERATION)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const listed = (await team.team()).filter((m) => Object.values(ids).includes(m.id));
    expect(listed.map((m) => [m.role, m.backofficeAreas.length])).toEqual(
      expect.arrayContaining([
        [Role.SYSTEM_ADMIN, 5],
        [Role.SYSTEM_MANAGER, 1],
        [Role.SYSTEM_MANAGER, 0],
      ]),
    );
    expect(listed.some((m) => m.id === ids.dono)).toBe(false);
  });

  it('quem sai da equipe do sistema perde as áreas', async () => {
    await createUser('saindo', Role.SYSTEM_MANAGER, [BackofficeArea.USERS]);
    await users.updateUserRole(ids.saindo, Role.BARBERSHOP_OWNER);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: ids.saindo } });
    expect(after.backofficeAreas).toEqual([]);
  });

  it('equipe não mexe em conta do sistema; o admin mexe', async () => {
    const actor = (key: string, role: Role) => ({ id: ids[key], role: { id: 0, name: role } });
    await expect(
      users.assertCanManageUsers(actor('suporte', Role.SYSTEM_MANAGER), [ids.admin]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      users.assertCanManageUsers(actor('suporte', Role.SYSTEM_MANAGER), [ids.dono, ids.semarea]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      users.assertCanManageUsers(actor('suporte', Role.SYSTEM_MANAGER), [ids.dono]),
    ).resolves.toBeUndefined();
    await expect(
      users.assertCanManageUsers(actor('admin', Role.SYSTEM_ADMIN), [ids.semarea]),
    ).resolves.toBeUndefined();
  });
});
