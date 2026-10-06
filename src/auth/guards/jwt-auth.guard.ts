// src\auth\guards\jwt-auth.guard.ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { isSystemRole } from '../backoffice-areas';
import { staffFromHeaders, staffPrincipal } from '../staff-assertion';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Rota de sistema chamada pela API do backoffice com a afirmação da
    // equipe (ver staff-assertion.ts): age como a equipe, sem o cookie
    const req = context.switchToHttp().getRequest<Request>();
    const staff = staffFromHeaders(req?.headers);
    if (staff) {
      const roles =
        this.reflector.getAllAndOverride<string[]>('roles', [
          context.getHandler(),
          context.getClass(),
        ]) ?? [];
      if (roles.some((r) => isSystemRole(r))) {
        // A equipe não é User: o principal só tem o que as operações de sistema usam
        req.user = staffPrincipal(staff) as unknown as Request['user'];
        return true;
      }
    }
    return super.canActivate(context);
  }
}
