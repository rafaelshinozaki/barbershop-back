import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { BACKOFFICE_AREA_KEY, BackofficeArea } from './backoffice-areas';
import { RolesGuard } from './guards/roles.guard';
import { Role } from './interfaces/roles';
import {
  STAFF_HEADER,
  signStaffAssertion,
  staffFromHeaders,
  staffPrincipal,
  verifyStaffAssertion,
  type StaffAssertion,
} from './staff-assertion';

/**
 * Equipe vinda da API do backoffice (S2): a afirmação só vale assinada com o
 * segredo do gateway, dentro do prazo, e junto com o próprio segredo.
 */
const SECRET = 'segredo-do-gateway-com-32-caracteres!';
const now = Date.now();
const base: StaffAssertion = {
  sid: 7,
  email: 'ana@plataforma.test',
  name: 'Ana',
  role: 'support_n1',
  uid: null,
  exp: Math.floor(now / 1000) + 60,
};

describe('afirmação da equipe (x-backoffice-staff)', () => {
  it('vale assinada com o segredo e no prazo', () => {
    expect(verifyStaffAssertion(signStaffAssertion(base, SECRET), SECRET, now)).toEqual(base);
  });

  it('não vale: outro segredo, adulterada, vencida, cargo desconhecido ou sem segredo', () => {
    const token = signStaffAssertion(base, SECRET);
    expect(verifyStaffAssertion(token, 'outro-segredo', now)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...base, role: 'super_admin' })).toString(
      'base64url',
    );
    expect(verifyStaffAssertion(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(verifyStaffAssertion(`${body}.`, SECRET, now)).toBeNull();
    expect(
      verifyStaffAssertion(
        signStaffAssertion({ ...base, exp: Math.floor(now / 1000) - 1 }, SECRET),
        SECRET,
        now,
      ),
    ).toBeNull();
    expect(
      verifyStaffAssertion(
        signStaffAssertion({ ...base, role: 'root' as never }, SECRET),
        SECRET,
        now,
      ),
    ).toBeNull();
    expect(verifyStaffAssertion(token, undefined, now)).toBeNull();
    expect(verifyStaffAssertion(token, '', now)).toBeNull();
  });

  it('só junto com o segredo do gateway certo', () => {
    const headers = { [STAFF_HEADER]: signStaffAssertion(base, SECRET) };
    expect(staffFromHeaders(headers, SECRET)).toBeNull();
    expect(staffFromHeaders({ ...headers, 'x-backoffice-gateway': 'errado' }, SECRET)).toBeNull();
    expect(staffFromHeaders({ ...headers, 'x-backoffice-gateway': SECRET }, SECRET)).toMatchObject({
      sid: 7,
    });
    // Sem o segredo configurado (dev), nunca vale
    expect(staffFromHeaders({ ...headers, 'x-backoffice-gateway': SECRET }, undefined)).toBeNull();
  });

  it('cargo vira o papel e as áreas antigos', () => {
    expect(staffPrincipal({ ...base, role: 'super_admin' }).role.name).toBe(Role.SYSTEM_ADMIN);
    expect(staffPrincipal({ ...base, role: 'moderator' })).toMatchObject({
      id: 7,
      role: { name: Role.SYSTEM_MANAGER },
      backofficeAreas: expect.arrayContaining([BackofficeArea.MODERATION]),
    });
    expect(staffPrincipal(base).backofficeAreas).not.toContain(BackofficeArea.FINANCE);
  });
});

describe('RolesGuard com a equipe da API do backoffice', () => {
  const guard = (roles: Role[], area?: BackofficeArea) =>
    new RolesGuard(
      { getAllAndOverride: (key: string) => (key === BACKOFFICE_AREA_KEY ? area : roles) } as never,
      {} as never,
      {
        verify: () => {
          throw new Error('a equipe não usa o token do app');
        },
      } as never,
      { get: (k: string) => (k === 'BACKOFFICE_GATEWAY_SECRET' ? SECRET : undefined) } as never,
    );
  const ctx = (req: Record<string, unknown>) =>
    ({
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext);
  const request = (a: Partial<StaffAssertion> = {}) => ({
    headers: {
      'x-backoffice-gateway': SECRET,
      [STAFF_HEADER]: signStaffAssertion({ ...base, ...a }, SECRET),
    },
    cookies: {},
  });

  it('na área do cargo: passa, sem cookie, e age como a equipe', async () => {
    const req = request() as Record<string, unknown>;
    await expect(
      guard([Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER], BackofficeArea.SUPPORT).canActivate(ctx(req)),
    ).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 7, staff: { role: 'support_n1' } });
    expect(req.backofficeActor).toEqual({ id: 7, email: base.email, role: 'support_n1' });
  });

  it('fora da área do cargo, ou operação só do admin: recusa', async () => {
    await expect(
      guard([Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER], BackofficeArea.FINANCE).canActivate(
        ctx(request()),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard([Role.SYSTEM_ADMIN]).canActivate(ctx(request()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Operação do dono de barbearia não é da equipe
    await expect(
      guard([Role.BARBERSHOP_OWNER]).canActivate(ctx(request({ role: 'super_admin' }))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('super admin passa na operação só do admin', async () => {
    await expect(
      guard([Role.SYSTEM_ADMIN]).canActivate(ctx(request({ role: 'super_admin' }))),
    ).resolves.toBe(true);
  });
});
