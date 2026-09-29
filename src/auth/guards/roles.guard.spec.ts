import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Role } from '../interfaces/roles';
import { gatewayAllowed, isBackofficeOnly, RolesGuard } from './roles.guard';

/**
 * Operação só de admin/gerente do sistema, com BACKOFFICE_GATEWAY_SECRET
 * configurado, só passa vinda da API do backoffice (header
 * x-backoffice-gateway). Sem a variável, nada muda.
 */
describe('RolesGuard: operação do backoffice só pela API do backoffice', () => {
  it('backoffice = todos os cargos exigidos são do sistema', () => {
    expect(isBackofficeOnly([Role.SYSTEM_ADMIN])).toBe(true);
    expect(isBackofficeOnly([Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER])).toBe(true);
    // Operação que o dono também usa não entra na regra
    expect(isBackofficeOnly([Role.SYSTEM_ADMIN, Role.BARBERSHOP_OWNER])).toBe(false);
    expect(isBackofficeOnly([])).toBe(false);
  });

  it('segredo: sem configurar, passa; configurado, só com o header certo', () => {
    expect(gatewayAllowed(undefined, undefined)).toBe(true);
    expect(gatewayAllowed('', undefined)).toBe(true);
    expect(gatewayAllowed('s3cr3t', 's3cr3t')).toBe(true);
    expect(gatewayAllowed('s3cr3t', 'errado')).toBe(false);
    expect(gatewayAllowed('s3cr3t', undefined)).toBe(false);
    expect(gatewayAllowed('s3cr3t', ['s3cr3t'])).toBe(false);
  });

  const guardFor = (roles: Role[], secret?: string) =>
    new RolesGuard(
      { getAllAndOverride: () => roles } as never,
      {} as never,
      {
        verify: () => {
          throw new Error('não deve chegar no token');
        },
      } as never,
      { get: (k: string) => (k === 'BACKOFFICE_GATEWAY_SECRET' ? secret : undefined) } as never,
    );
  // Contexto REST (o GqlExecutionContext cai no catch e usa o HTTP)
  const httpContext = (headers: Record<string, string>) =>
    ({
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ headers, cookies: {} }) }),
    } as unknown as ExecutionContext);

  it('com segredo: sem o header, o backoffice é recusado antes de olhar o login', async () => {
    const guard = guardFor([Role.SYSTEM_ADMIN], 's3cr3t');
    await expect(guard.canActivate(httpContext({}))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('com o header certo segue pro login (aqui sem token: 401)', async () => {
    const guard = guardFor([Role.SYSTEM_ADMIN], 's3cr3t');
    await expect(
      guard.canActivate(httpContext({ 'x-backoffice-gateway': 's3cr3t' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sem segredo configurado, ou operação que não é só do sistema: regra não se aplica', async () => {
    await expect(guardFor([Role.SYSTEM_ADMIN]).canActivate(httpContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guardFor([Role.SYSTEM_ADMIN, Role.BARBERSHOP_OWNER], 's3cr3t').canActivate(httpContext({})),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
