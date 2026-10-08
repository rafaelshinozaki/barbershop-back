// src\auth\strategies\jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { TokenPayload } from '../interfaces/token-payload.interface';
import { UserService } from '@/auth/users/users.service';
import { staffClaims } from '../session-claims';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([(req: Request) => req.cookies?.Authentication]),
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: TokenPayload) {
    // Só sessão da equipe: cookie do cliente ou state do OAuth não valem
    const claims = staffClaims(payload);
    if (!claims) throw new UnauthorizedException('Invalid session');
    const { userId, sessionToken } = claims;

    const user = await this.userService.getUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // A sessão precisa ter uma ActiveSession correspondente — é isso que faz
    // "Terminar sessão"/"Sair de outras sessões" realmente revogar o acesso,
    // e não só remover uma linha decorativa da lista.
    const activeSession = await this.userService.findActiveSessionByToken(sessionToken);
    if (!activeSession || activeSession.userId !== user.id) {
      throw new UnauthorizedException('Session has been terminated');
    }

    return { ...user, sessionToken };
  }
}
