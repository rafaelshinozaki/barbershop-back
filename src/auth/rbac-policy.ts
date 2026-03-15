// src/auth/rbac-policy.ts
import { RolesBuilder } from 'nest-access-control';
import { Role } from './interfaces/roles';

export const RBAC_POLICY: RolesBuilder = new RolesBuilder();

// prettier-ignore
RBAC_POLICY
  .grant(Role.SYSTEM_MANAGER)
  .grant(Role.SYSTEM_ADMIN)
    .extend(Role.SYSTEM_MANAGER)
  .grant(Role.BARBERSHOP_OWNER)
  .grant(Role.BARBERSHOP_MANAGER)
  .grant(Role.BARBERSHOP_EMPLOYEE)

// SYSTEM_ADMIN -> SYSTEM_MANAGER
// BARBERSHOP_OWNER, BARBERSHOP_MANAGER, BARBERSHOP_EMPLOYEE: roles para módulo barbearia
