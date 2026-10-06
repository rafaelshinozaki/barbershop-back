import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { SmartLogger } from '@/common/logger.util';
import { renewIfStale, type SessionPayload } from '@/auth/session-cookie';
import { staffClaims, staffSessionToken } from '@/auth/session-claims';
import { staffFromHeaders, staffPrincipal } from '@/auth/staff-assertion';
import { isSystemRole } from '@/auth/backoffice-areas';

/** A query segue sem usuário quando não há sessão. Token inválido também não bloqueia. */
export const OptionalAuth = () => SetMetadata('authOptional', true);

@Injectable()
export class GraphQLJwtAuthGuard implements CanActivate {
  private readonly logger = new SmartLogger('GraphQLJwtAuthGuard');

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const optional = this.reflector.getAllAndOverride<boolean>('authOptional', [
      context.getHandler(),
      context.getClass(),
    ]);
    const gqlContext = GqlExecutionContext.create(context);
    const { req, res } = gqlContext.getContext();

    // Equipe da plataforma vinda da API do backoffice (ver staff-assertion.ts)
    const staff = staffFromHeaders(
      req?.headers,
      this.configService.get<string>('BACKOFFICE_GATEWAY_SECRET'),
    );
    if (staff) {
      const roles =
        this.reflector.getAllAndOverride<string[]>('roles', [
          context.getHandler(),
          context.getClass(),
        ]) ?? [];
      // Operação de sistema: age como a equipe (o RolesGuard já conferiu o cargo)
      if (roles.some((r) => isSystemRole(r))) {
        req.user = staffPrincipal(staff);
        return true;
      }
      // Operação da própria conta (avisos, preferências): só quem veio de uma
      // conta antiga do sistema, e como ela. Conta nova da equipe não é User.
      if (staff.uid) {
        const legacy = await this.prisma.user.findUnique({
          where: { id: staff.uid },
          include: { role: true },
        });
        if (legacy && legacy.isActive !== false && isSystemRole(legacy.role?.name)) {
          req.user = legacy;
          return true;
        }
      }
      if (optional) return true;
      throw new UnauthorizedException('Operação indisponível para a equipe da plataforma.');
    }

    // Cabeçalho Bearer ou o cookie `Authentication` (nome exato)
    const token = staffSessionToken(req);

    // Debug log
    if (!token) {
      if (optional) return true;
      this.logger.warn('No authentication token found');
      throw new UnauthorizedException('No authentication token found');
    }
    this.logger.debug('Token found');

    try {
      // Decode the JWT
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as SessionPayload & { iat?: number };
      // Só sessão da equipe: cookie do cliente ou state do OAuth não valem
      const claims = staffClaims(decoded);
      if (!claims) throw new UnauthorizedException('Invalid session');

      // Find user in database using userId from token
      const user = await this.prisma.user.findUnique({
        where: { id: claims.userId },
        include: { role: true },
      });

      if (!user) {
        this.logger.error('User not found in database', { userId: decoded.userId });
        throw new UnauthorizedException('User not found');
      }

      // A sessão precisa ter uma ActiveSession correspondente — é isso que
      // faz "Terminar sessão"/"Sair de outras sessões" realmente revogar o
      // acesso, e não só remover uma linha decorativa da lista.
      const activeSession = await this.prisma.activeSession.findUnique({
        where: { sessionToken: claims.sessionToken },
      });
      if (!activeSession || activeSession.userId !== user.id) {
        throw new UnauthorizedException('Session has been terminated');
      }

      // Em uso: renova o prazo da sessão (quem usa todo dia não cai)
      renewIfStale(
        this.jwtService,
        res,
        decoded,
        this.configService.get<string>('NODE_ENV') === 'production',
      );

      // Attach user to request for use in resolvers
      req.user = { ...user, sessionToken: decoded.sessionToken };
      this.logger.log('User attached to request', {
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role?.name,
      });

      return true;
    } catch (error) {
      if (optional) return true;
      this.logger.warn('Invalid token', error);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
