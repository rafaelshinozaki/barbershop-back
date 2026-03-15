import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Role } from '../interfaces/roles';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SmartLogger } from '@/common/logger.util';

@Injectable()
export class GraphQLRolesGuard implements CanActivate {
  private readonly logger = new SmartLogger('GraphQLRolesGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    this.logger.log('Required roles', requiredRoles);

    if (!requiredRoles || requiredRoles.length === 0) {
      this.logger.log('No roles required, allowing access');
      return true; // No roles required, allow access
    }

    const gqlContext = GqlExecutionContext.create(context);
    const { req } = gqlContext.getContext();

    this.logger.logEssential('Request headers', req.headers, ['authorization', 'cookie']);
    this.logger.logEssential('Request cookies', req.cookies, ['Authentication', 'token']);

    // Try to get token from Authorization header first
    let token = req.headers?.authorization?.replace('Bearer ', '');

    // If no Authorization header, try cookies
    if (!token && req.cookies) {
      token = req.cookies?.Authentication;
    }

    this.logger.log('Token found', !!token);

    if (!token) {
      this.logger.warn('No authentication token found');
      throw new UnauthorizedException('No authentication token found');
    }

    try {
      // Decode the JWT
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as {
        userId: number;
      };

      this.logger.log('Token decoded, userId', decoded.userId);

      // Find user in database using userId from token
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { role: true },
      });

      this.logger.log('User found', { id: user?.id, role: user?.role?.name });

      if (!user) {
        this.logger.warn('User not found');
        throw new UnauthorizedException('User not found');
      }

      // Check if user has one of the required roles
      const hasRequiredRole = requiredRoles.some(
        (r) => r.toLowerCase() === user.role.name.toLowerCase(),
      );
      this.logger.log('User has required role', hasRequiredRole);

      return hasRequiredRole;
    } catch (error) {
      this.logger.error('Error in GraphQLRolesGuard', error);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
