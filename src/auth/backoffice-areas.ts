import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { Role } from './interfaces/roles';

/**
 * Áreas do backoffice. O SystemAdmin (mestre) vê tudo; a equipe do sistema
 * (SystemManager) só as áreas que o admin liberou pra ela (User.backofficeAreas).
 * O que é só do admin (preços, planos, cupons, cargos, a própria equipe)
 * continua com @Roles(Role.SYSTEM_ADMIN).
 */
export enum BackofficeArea {
  /** Pedidos de suporte e contas de cliente (suspender/reativar) */
  SUPPORT = 'support',
  /** Denúncias, avaliações denunciadas, fotos e perfis públicos */
  MODERATION = 'moderation',
  /** Usuários da plataforma: ver, editar, ativar/desativar, importar */
  USERS = 'users',
  /** Planos dos usuários, cobranças recorrentes e receita do Destaque */
  FINANCE = 'finance',
  /** Painel e métricas, piloto, Destaque, avisos e e-mails para usuários */
  OPERATIONS = 'operations',
}

export const BACKOFFICE_AREAS: string[] = Object.values(BackofficeArea);

export const BACKOFFICE_AREA_KEY = 'backofficeArea';

/**
 * Área da operação. Obrigatória em toda operação que aceita SystemManager (o
 * teste resolver-guards.spec confere); sem ela, a equipe é recusada.
 */
export const RequireArea = (area: BackofficeArea) => SetMetadata(BACKOFFICE_AREA_KEY, area);

const isRole = (name: string | undefined, role: Role) =>
  (name ?? '').toLowerCase() === role.toLowerCase();

/** A equipe do sistema (SystemManager) tem a área? O admin sempre tem. */
export function hasBackofficeArea(
  roleName: string | undefined,
  areas: string[] | null | undefined,
  area: string | undefined,
): boolean {
  if (isRole(roleName, Role.SYSTEM_ADMIN)) return true;
  if (!isRole(roleName, Role.SYSTEM_MANAGER)) return false;
  return !!area && (areas ?? []).includes(area);
}

export function isSystemRole(roleName: string | undefined): boolean {
  return isRole(roleName, Role.SYSTEM_ADMIN) || isRole(roleName, Role.SYSTEM_MANAGER);
}

/**
 * Só o admin mexe em conta do sistema (admin ou equipe): senão alguém da
 * equipe trocava o e-mail do admin, desativava ou apagava a conta dele.
 */
export function assertCanManageAccounts(
  actorRole: string | undefined,
  targetRoles: (string | undefined)[],
): void {
  if (isRole(actorRole, Role.SYSTEM_ADMIN)) return;
  if (targetRoles.some(isSystemRole)) {
    throw new ForbiddenException('Só o admin do sistema altera contas da equipe do sistema.');
  }
}
