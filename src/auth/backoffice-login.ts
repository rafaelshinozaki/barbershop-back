import { isSystemRole } from './backoffice-areas';

type LoginUser = {
  twoFactorEnabled?: boolean | null;
  role?: { name?: string } | string | null;
};

/**
 * Duas etapas obrigatórias pra conta do sistema (admin e equipe)?
 * BACKOFFICE_REQUIRE_2FA=true/false decide; sem a variável, só em produção
 * (em dev e nos testes o código por e-mail atrapalharia).
 */
export function backofficeRequires2fa(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.BACKOFFICE_REQUIRE_2FA?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return env.NODE_ENV === 'production';
}

const roleName = (user: LoginUser) =>
  typeof user.role === 'string' ? user.role : user.role?.name ?? undefined;

/** O login precisa do código por e-mail? (quem ligou, ou conta do sistema) */
export function needsLoginCode(user: LoginUser, env: NodeJS.ProcessEnv = process.env): boolean {
  if (user.twoFactorEnabled) return true;
  return isSystemRole(roleName(user)) && backofficeRequires2fa(env);
}

/** Conta do sistema não entra pelo login social (sem senha nem código). */
export const socialLoginAllowed = (user: LoginUser) => !isSystemRole(roleName(user));
