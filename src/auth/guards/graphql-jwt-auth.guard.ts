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

    // Try to get token from Authorization header first
    let token = req.headers?.authorization?.replace('Bearer ', '');

    // If no Authorization header, try cookies (multiple possible names)
    if (!token && req.cookies) {
      token = req.cookies.Authentication || req.cookies.token || req.cookies.access_token;
    }

    // Fallback: parse cookie header manually if req.cookies is undefined
    if (!token && req.headers?.cookie) {
      const cookieHeader = req.headers.cookie;
      const match = cookieHeader.match(/(Authentication|token|access_token)=([^;]+)/);
      if (match) {
        token = match[2];
      }
    }

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

      this.logger.log('JWT decoded successfully', {
        userId: decoded.userId,
        email: decoded.email,
        tokenLength: token.length,
        decodedPayload: decoded,
      });

      // Find user in database using userId from token
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { role: true },
      });

      if (!user) {
        this.logger.error('User not found in database', { userId: decoded.userId });
        throw new UnauthorizedException('User not found');
      }

      // A sessão precisa ter uma ActiveSession correspondente — é isso que
      // faz "Terminar sessão"/"Sair de outras sessões" realmente revogar o
      // acesso, e não só remover uma linha decorativa da lista.
      if (decoded.sessionToken) {
        const activeSession = await this.prisma.activeSession.findUnique({
          where: { sessionToken: decoded.sessionToken },
        });
        if (!activeSession) {
          throw new UnauthorizedException('Session has been terminated');
        }
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
