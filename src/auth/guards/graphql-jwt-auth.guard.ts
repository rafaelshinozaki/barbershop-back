import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { SmartLogger } from '@/common/logger.util';

@Injectable()
export class GraphQLJwtAuthGuard implements CanActivate {
  private readonly logger = new SmartLogger('GraphQLJwtAuthGuard');

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const gqlContext = GqlExecutionContext.create(context);
    const { req } = gqlContext.getContext();

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
      this.logger.warn('No authentication token found');
    } else {
      this.logger.log('Token found', {
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...',
        headers: Object.keys(req.headers || {}),
        cookies: Object.keys(req.cookies || {}),
      });
    }

    if (!token) {
      throw new UnauthorizedException('No authentication token found');
    }

    try {
      // Decode the JWT
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as {
        userId: number;
        email: string;
      };

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

      // Attach user to request for use in resolvers
      req.user = user;
      this.logger.log('User attached to request', {
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role?.name,
      });

      return true;
    } catch (error) {
      this.logger.warn('Invalid token', error);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
