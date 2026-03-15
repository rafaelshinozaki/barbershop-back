// src\auth\guards\roles.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Role } from '../interfaces/roles';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

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
    let token: string;

    try {
      // Try GraphQL context first
      const gqlContext = GqlExecutionContext.create(context);
      req = gqlContext.getContext().req;

      // Try to get token from Authorization header first
      token = req.headers?.authorization?.replace('Bearer ', '');

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
    } catch {
      // Fallback to HTTP context
      req = context.switchToHttp().getRequest<Request>();
      token = req.cookies?.Authentication;
    }

    if (!token) {
      throw new UnauthorizedException('No authentication token found');
    }

    try {
      // Decodifica o JWT
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as {
        userId: number;
      };

      // Busca o usuário no banco de dados usando o userId do token
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { role: true }, // Inclui as roles
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Verifica se o usuário tem uma das roles necessárias
      return requiredRoles.some((r) => r.toLowerCase() === user.role.name.toLowerCase());
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
