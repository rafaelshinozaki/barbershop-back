// src/auth/rbac-policy.ts
import { RolesBuilder } from 'nest-access-control';
import { Role } from './interfaces/roles';

export const RBAC_POLICY: RolesBuilder = new RolesBuilder();

// prettier-ignore
RBAC_POLICY
  .grant(Role.USER)
  .grant(Role.MANAGER)
    .extend(Role.USER)
  .grant(Role.ADMIN)
    .extend(Role.MANAGER)
  .grant(Role.BARBERSHOP_OWNER)
    .extend(Role.USER)
  .grant(Role.BARBERSHOP_EMPLOYEE)
    .extend(Role.USER)

// ADMIN -> MANAGER -> USER
// BARBERSHOP_OWNER, BARBERSHOP_EMPLOYEE: roles para módulo barbearia
