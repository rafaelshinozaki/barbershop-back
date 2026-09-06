import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-apple';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { isAppleConfigured } from '../interfaces/apple-config.util';

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(configService: ConfigService) {
    const configured = isAppleConfigured(configService);
    super({
      clientID: configured ? configService.get<string>('APPLE_CLIENT_ID') : 'disabled',
      teamID: configured ? configService.get<string>('APPLE_TEAM_ID') : 'disabled',
      keyID: configured ? configService.get<string>('APPLE_KEY_ID') : 'disabled',
      // O .env guarda a chave .p8 com quebras de linha escapadas (\n) porque
      // variáveis de ambiente não suportam multi-linha real.
      privateKeyString: configured
        ? configService.get<string>('APPLE_PRIVATE_KEY')?.replace(/\\n/g, '\n')
        : 'disabled',
      callbackURL: configured ? configService.get<string>('APPLE_CALLBACK_URL') : 'disabled',
    });
  }

  // Apple não expõe um endpoint de perfil como Google/Facebook — os dados do
  // usuário vêm dentro do id_token (JWT) retornado na troca do code, então
  // decodificamos ele aqui. O id_token já veio direto do servidor da Apple
  // (troca server-to-server com nosso client_secret), então não precisa
  // verificar a assinatura de novo para simplesmente ler as claims.
  validate(
    req: any,
    accessToken: string,
    refreshToken: string,
    idToken: string,
    _profile: unknown,
    done: (err: unknown, user: any) => void,
  ) {
    try {
      const decoded = jwt.decode(idToken) as { email?: string; sub: string } | null;
      const email = decoded?.email;

      if (!email) {
        return done(new Error('Email não fornecido pela Apple'), null);
      }

      // O nome só vem (via req.appleProfile) na primeira autorização — em
      // logins seguintes a Apple não reenvia, então caímos no prefixo do email.
      const displayName = req.appleProfile?.name
        ? `${req.appleProfile.name.firstName ?? ''} ${req.appleProfile.name.lastName ?? ''}`.trim()
        : email.split('@')[0];

      done(null, { email, displayName });
    } catch (error) {
      done(error, null);
    }
  }
}
