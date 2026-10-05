// src\auth\guards\roles.guard.ts
//
// Consolidated role guard — works for both REST controllers and GraphQL
// resolvers (a separate GraphQLRolesGuard used to duplicate this logic with
// slightly different token-extraction and error-handling; merged here so
// there's one implementation to keep correct).
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Role } from '../interfaces/roles';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { BACKOFFICE_AREA_KEY, hasBackofficeArea } from '../backoffice-areas';
import { staffClaims, staffSessionToken } from '../session-claims';

const SYSTEM_ROLES = [Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER].map((r) => r.toLowerCase());

/**
 * Operação só de admin/gerente do sistema (backoffice). Com
 * BACKOFFICE_GATEWAY_SECRET configurado, ela só é aceita vinda da API do
 * backoffice (repo barbershop-backoffice-back), que manda o segredo no
 * header x-backoffice-gateway: a API pública deixa de expor o backoffice,
 * mesmo pra quem tem o login de admin. Sem a variável (dev, testes), não
 * muda nada.
 */
export function isBackofficeOnly(roles: string[]): boolean {
  return roles.length > 0 && roles.every((r) => SYSTEM_ROLES.includes(String(r).toLowerCase()));
}

export function gatewayAllowed(
  secret: string | undefined,
  header: string | string[] | undefined,
): boolean {
  if (!secret) return true;
  if (typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService, // Para obter a JWT_SECRET
  ) {}

  async canActivate(context: ExecutionContext) {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // No roles required, allow access
    }

    let req: Request;
    let token: string | undefined;

    try {
      // Try GraphQL context first
      const gqlContext = GqlExecutionContext.create(context);
      req = gqlContext.getContext().req;

      // Cabeçalho Bearer ou o cookie `Authentication` (nome exato)
      token = staffSessionToken(req);
    } catch {
      // Fallback to HTTP context
      req = context.switchToHttp().getRequest<Request>();
      token = req.cookies?.Authentication;
    }

    if (
      isBackofficeOnly(requiredRoles) &&
      !gatewayAllowed(
        this.configService.get<string>('BACKOFFICE_GATEWAY_SECRET'),
        req?.headers?.['x-backoffice-gateway'],
      )
    ) {
      throw new ForbiddenException('Operação do backoffice: use o app do backoffice.');
    }

    if (!token) {
      throw new UnauthorizedException('No authentication token found');
    }

    try {
      // Decodifica o JWT
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      // Só sessão da equipe: cookie do cliente ou state do OAuth não valem
      const claims = staffClaims(decoded);
      if (!claims) throw new UnauthorizedException('Invalid session');

      // Busca o usuário no banco de dados usando o userId do token
      const user = await this.prisma.user.findUnique({
        where: { id: claims.userId },
        include: { role: true }, // Inclui as roles
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      const activeSession = await this.prisma.activeSession.findUnique({
        where: { sessionToken: claims.sessionToken },
      });
      if (!activeSession || activeSession.userId !== user.id) {
        throw new UnauthorizedException('Session has been terminated');
      }

      if (!user.role) {
        throw new ForbiddenException('User has no role assigned. Contact administrator.');
      }

      // Verifica se o usuário tem uma das roles necessárias
      const hasRequiredRole = requiredRoles.some(
        (r) => r.toLowerCase() === user.role.name.toLowerCase(),
      );
      if (!hasRequiredRole) {
        throw new ForbiddenException(
          `Access denied. Required roles: ${requiredRoles.join(', ')}. Your role: ${
            user.role.name
          }`,
        );
      }

      // Quem chamou, pro registro de ações do backoffice (nem toda operação
      // passa pelo guard do JWT, que é quem preenche req.user)
      if (req) {
        (req as Request & { backofficeActor?: unknown }).backofficeActor = {
          id: user.id,
          email: user.email,
          role: user.role.name,
        };
      }

      // Equipe do sistema: só nas áreas do backoffice liberadas pelo admin.
      // Operação que aceita SystemManager sem @RequireArea recusa a equipe.
      if (user.role.name.toLowerCase() === Role.SYSTEM_MANAGER.toLowerCase()) {
        const area = this.reflector.getAllAndOverride<string>(BACKOFFICE_AREA_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);
        if (!hasBackofficeArea(user.role.name, user.backofficeAreas, area)) {
          throw new ForbiddenException('Sem acesso a esta área do backoffice.');
        }
      }
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
