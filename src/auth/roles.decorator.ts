// src\auth\roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Role } from './interfaces/roles';

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
