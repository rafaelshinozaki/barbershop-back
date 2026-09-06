// src\auth\strategies\jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { TokenPayload } from '../interfaces/token-payload.interface';
import { UserService } from '@/auth/users/users.service';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([(req: Request) => req.cookies?.Authentication]),
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate({ userId, sessionToken }: TokenPayload, req: Request) {
    // Verificar se o token foi invalidado
    const token = req.cookies?.Authentication;
    if (token) {
      const isInvalidated = await this.authService.isTokenInvalidated(token, userId);
      if (isInvalidated) {
        throw new UnauthorizedException('Token has been invalidated');
      }
    }

    // Buscar o usuário e verificar se houve invalidação recente
    const user = await this.userService.getUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Verificar se o token foi emitido antes da última invalidação
    if (token && user.updatedAt) {
      const tokenData = this.authService.decodeToken(token);
      if (tokenData && tokenData.iat) {
        const tokenIssuedAt = new Date(tokenData.iat * 1000);
        if (tokenIssuedAt < user.updatedAt) {
          throw new UnauthorizedException('Token has been invalidated by logout other sessions');
        }
      }
    }

    // A sessão precisa ter uma ActiveSession correspondente — é isso que faz
    // "Terminar sessão"/"Sair de outras sessões" realmente revogar o acesso,
    // e não só remover uma linha decorativa da lista.
    if (sessionToken) {
      const activeSession = await this.userService.findActiveSessionByToken(sessionToken);
      if (!activeSession) {
        throw new UnauthorizedException('Session has been terminated');
      }
    }

    return { ...user, sessionToken };
  }
}
