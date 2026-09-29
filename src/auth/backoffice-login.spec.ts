import { Role } from './interfaces/roles';
import { backofficeRequires2fa, needsLoginCode, socialLoginAllowed } from './backoffice-login';
import { AuthResolver } from '../graphql/resolvers/auth.resolver';

/**
 * Conta do sistema (admin e equipe) entra com código por e-mail quando a
 * regra vale (BACKOFFICE_REQUIRE_2FA ou produção) e nunca pelo login social.
 */
describe('login da conta do sistema', () => {
  const admin = { twoFactorEnabled: false, role: { name: Role.SYSTEM_ADMIN } };
  const staff = { twoFactorEnabled: false, role: Role.SYSTEM_MANAGER };
  const owner = { twoFactorEnabled: false, role: { name: Role.BARBERSHOP_OWNER } };

  it('regra: variável manda; sem ela, só em produção', () => {
    expect(backofficeRequires2fa({ BACKOFFICE_REQUIRE_2FA: 'true' })).toBe(true);
    expect(backofficeRequires2fa({ BACKOFFICE_REQUIRE_2FA: 'false', NODE_ENV: 'production' })).toBe(
      false,
    );
    expect(backofficeRequires2fa({ NODE_ENV: 'production' })).toBe(true);
    expect(backofficeRequires2fa({ NODE_ENV: 'development' })).toBe(false);
    expect(backofficeRequires2fa({})).toBe(false);
  });

  it('código: conta do sistema com a regra; quem ligou, sempre', () => {
    const on = { BACKOFFICE_REQUIRE_2FA: 'true' };
    expect(needsLoginCode(admin, on)).toBe(true);
    expect(needsLoginCode(staff, on)).toBe(true);
    expect(needsLoginCode(owner, on)).toBe(false);
    expect(needsLoginCode(admin, {})).toBe(false);
    expect(needsLoginCode({ ...owner, twoFactorEnabled: true }, {})).toBe(true);
  });

  it('login social: conta do sistema não entra', () => {
    expect(socialLoginAllowed(admin)).toBe(false);
    expect(socialLoginAllowed(staff)).toBe(false);
    expect(socialLoginAllowed(owner)).toBe(true);
  });

  describe('mutation login', () => {
    const before = process.env.BACKOFFICE_REQUIRE_2FA;
    afterEach(() => {
      if (before === undefined) delete process.env.BACKOFFICE_REQUIRE_2FA;
      else process.env.BACKOFFICE_REQUIRE_2FA = before;
    });

    const resolverFor = (user: object) => {
      const authService = { login: jest.fn() };
      const userService = {
        verifyUser: jest.fn().mockResolvedValue({ id: 1, email: 'a@b.c', ...user }),
        sendLoginCode: jest.fn(),
      };
      const resolver = new AuthResolver(
        authService as never,
        userService as never,
        {} as never,
        {} as never,
        {} as never,
      );
      return { resolver, authService, userService };
    };
    const login = (resolver: AuthResolver) =>
      resolver.login({ email: 'a@b.c', password: 'x' } as never, { req: {}, res: {} });

    it('admin com a regra ligada: manda o código e não abre sessão', async () => {
      process.env.BACKOFFICE_REQUIRE_2FA = 'true';
      const { resolver, authService, userService } = resolverFor(admin);
      await expect(login(resolver)).resolves.toMatchObject({ twoFactorRequired: true });
      expect(userService.sendLoginCode).toHaveBeenCalled();
      expect(authService.login).not.toHaveBeenCalled();
    });

    it('dono de barbearia sem duas etapas: entra direto', async () => {
      process.env.BACKOFFICE_REQUIRE_2FA = 'true';
      const { resolver, authService, userService } = resolverFor(owner);
      await login(resolver);
      expect(userService.sendLoginCode).not.toHaveBeenCalled();
      expect(authService.login).toHaveBeenCalled();
    });
  });
});
