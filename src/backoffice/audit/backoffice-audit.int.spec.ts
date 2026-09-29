/**
 * Registro de ações do backoffice contra o banco de verdade: o interceptor
 * grava as escritas das operações da equipe do sistema (com os dados sem
 * segredo) e deixa de fora leituras e operações das barbearias.
 */
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../auth/interfaces/roles';
import { BACKOFFICE_AREA_KEY, BackofficeArea } from '../../auth/backoffice-areas';
import { BackofficeAuditInterceptor } from './backoffice-audit.interceptor';
import { BackofficeAuditService, sanitizeAuditArgs } from './backoffice-audit.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const STAFF = [Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER];

describe('sanitizeAuditArgs', () => {
  it('esconde segredos e corta textos e listas grandes', () => {
    const out = sanitizeAuditArgs({
      input: { email: 'a@b.c', newPassword: 'x', resetToken: 'y', code: 'CUPOM10' },
      body: 'x'.repeat(400),
      ids: Array.from({ length: 25 }, (_, i) => i),
    }) as Record<string, any>;
    expect(out.input).toEqual({
      email: 'a@b.c',
      newPassword: '[oculto]',
      resetToken: '[oculto]',
      code: 'CUPOM10',
    });
    expect(out.body).toMatch(/^x{300}… \(400\)$/);
    expect(out.ids).toHaveLength(21);
    expect(out.ids[20]).toBe('… +5');
  });
});

describe('registro de ações do backoffice (integração)', () => {
  const prisma = new PrismaService();
  const audit = new BackofficeAuditService(prisma);
  const actor = { id: 999001, email: `audit-${RUN}@test.local`, role: Role.SYSTEM_MANAGER };

  afterAll(async () => {
    await prisma.backofficeAuditLog.deleteMany({ where: { actorEmail: actor.email } });
    await prisma.$disconnect();
  });

  const interceptor = (roles: Role[], area?: BackofficeArea) =>
    new BackofficeAuditInterceptor(
      { getAllAndOverride: (key: string) => (key === BACKOFFICE_AREA_KEY ? area : roles) } as never,
      audit,
    );

  const gqlContext = (parent: string, field: string, args: object) =>
    ({
      getType: () => 'graphql',
      getHandler: () => undefined,
      getClass: () => undefined,
      getArgs: () => [
        null,
        args,
        { req: { backofficeActor: actor } },
        { parentType: { name: parent }, fieldName: field },
      ],
    } as unknown as ExecutionContext);

  const httpContext = (method: string, path: string, body: object) =>
    ({
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url: path,
          route: { path },
          body,
          params: {},
          backofficeActor: actor,
        }),
      }),
    } as unknown as ExecutionContext);

  const ok: CallHandler = { handle: () => of(true) };
  const fails: CallHandler = {
    handle: () => throwError(() => new Error('Usuário não encontrado')),
  };

  // A gravação não segura a resposta: espera ela aparecer
  const rows = async (operation: string, expected: number) => {
    for (let i = 0; i < 40; i++) {
      const found = await prisma.backofficeAuditLog.findMany({
        where: { actorEmail: actor.email, operation },
        orderBy: { id: 'asc' },
      });
      if (found.length >= expected) return found;
      await new Promise((r) => setTimeout(r, 25));
    }
    return prisma.backofficeAuditLog.findMany({ where: { actorEmail: actor.email, operation } });
  };

  it('mutation da equipe: grava quem, área, dados sem segredo e se deu certo', async () => {
    await lastValueFrom(
      interceptor(STAFF, BackofficeArea.USERS).intercept(
        gqlContext('Mutation', `setUserActive${RUN}`, { userId: 7, active: false, password: 'x' }),
        ok,
      ),
    );
    await expect(
      lastValueFrom(
        interceptor(STAFF, BackofficeArea.USERS).intercept(
          gqlContext('Mutation', `setUserActive${RUN}`, { userId: 8, active: true }),
          fails,
        ),
      ),
    ).rejects.toThrow('Usuário não encontrado');

    // Gravações em paralelo: a ordem não é garantida
    const found = await rows(`setUserActive${RUN}`, 2);
    const first = found.find((r) => (r.args as { userId?: number })?.userId === 7);
    const second = found.find((r) => (r.args as { userId?: number })?.userId === 8);
    expect(first).toMatchObject({
      actorId: actor.id,
      actorRole: Role.SYSTEM_MANAGER,
      area: 'users',
      success: true,
      error: null,
      args: { userId: 7, active: false, password: '[oculto]' },
    });
    expect(second).toMatchObject({ success: false, error: 'Usuário não encontrado' });
  });

  it('REST que escreve entra com método e rota', async () => {
    await lastValueFrom(
      interceptor(STAFF, BackofficeArea.FINANCE).intercept(
        httpContext('POST', `/user/admin/change-plan-${RUN}`, { userId: 3, plan: 'PRO' }),
        ok,
      ),
    );
    const [row] = await rows(`POST /user/admin/change-plan-${RUN}`, 1);
    expect(row).toMatchObject({ area: 'finance', args: { userId: 3, plan: 'PRO' } });
  });

  it('leitura, GET e operação que não é só do sistema ficam de fora', async () => {
    await lastValueFrom(
      interceptor(STAFF).intercept(gqlContext('Query', `usersDetailed${RUN}`, {}), ok),
    );
    await lastValueFrom(
      interceptor(STAFF).intercept(httpContext('GET', `/user/admin/list-${RUN}`, {}), ok),
    );
    await lastValueFrom(
      interceptor([Role.SYSTEM_ADMIN, Role.BARBERSHOP_OWNER]).intercept(
        gqlContext('Mutation', `createCoupon${RUN}`, {}),
        ok,
      ),
    );
    await new Promise((r) => setTimeout(r, 200));
    const found = await prisma.backofficeAuditLog.findMany({
      where: { actorEmail: actor.email, operation: { contains: RUN, not: { startsWith: 'set' } } },
    });
    expect(found.filter((f) => !f.operation.startsWith('POST'))).toEqual([]);
  });

  it('lista do admin: mais recentes primeiro, filtro por operação', async () => {
    const page = await audit.list({ operation: `setUserActive${RUN}` });
    expect(page.total).toBe(2);
    expect(page.items[0].id).toBeGreaterThan(page.items[1].id);
    expect(page.items.map((i) => JSON.parse(i.args ?? '{}').userId).sort()).toEqual([7, 8]);
  });
});
