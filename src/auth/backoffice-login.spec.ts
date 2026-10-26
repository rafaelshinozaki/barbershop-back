import { Role } from './interfaces/roles';
import {
  backofficeRequires2fa,
  needsLoginCode,
  needsSocialLoginCode,
  socialLoginAllowed,
} from './backoffice-login';
import { AuthController } from './auth.controller';
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

  describe('login social com duas etapas (item 315)', () => {
    it('pede o código só com as duas etapas ligadas e a opção marcada', () => {
      expect(needsSocialLoginCode({ twoFactorEnabled: true, socialLoginTwoFactor: true })).toBe(
        true,
      );
      expect(needsSocialLoginCode({ twoFactorEnabled: true, socialLoginTwoFactor: false })).toBe(
        false,
      );
      expect(needsSocialLoginCode({ twoFactorEnabled: false, socialLoginTwoFactor: true })).toBe(
        false,
      );
    });

    const callback = async (user: object) => {
      const authService = { login: jest.fn() };
      const userService = {
        findOrCreateSocialUser: jest
          .fn()
          .mockResolvedValue({ id: 1, email: 'a@b.c', phone: '119', ...user }),
        sendLoginCode: jest.fn(),
      };
      const controller = new AuthController(
        authService as never,
        userService as never,
        { get: (k: string) => (k === 'FRONTEND_URL' ? 'https://app.test' : undefined) } as never,
        {} as never,
      );
      const res = { redirect: jest.fn() };
      await (
        controller as unknown as {
          completeSocialLogin: (...args: unknown[]) => Promise<void>;
        }
      ).completeSocialLogin(
        { email: 'a@b.c', displayName: 'A', providerUserId: 'g1' },
        'google',
        { cookies: {} },
        res,
      );
      return { authService, userService, redirect: res.redirect.mock.calls[0]?.[0] as string };
    };

    it('opção marcada: manda o código e vai pra tela do código, sem sessão', async () => {
      const { authService, userService, redirect } = await callback({
        ...owner,
        twoFactorEnabled: true,
        socialLoginTwoFactor: true,
      });
      expect(userService.sendLoginCode).toHaveBeenCalled();
      expect(authService.login).not.toHaveBeenCalled();
      expect(redirect).toMatch(/^https:\/\/app\.test\/verification-code\?loginId=/);
    });

    it('opção desligada (padrão): entra direto pelo Google', async () => {
      const { authService, userService } = await callback({ ...owner, twoFactorEnabled: true });
      expect(userService.sendLoginCode).not.toHaveBeenCalled();
      expect(authService.login).toHaveBeenCalled();
    });
  });
});
