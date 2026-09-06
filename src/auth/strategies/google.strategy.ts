import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const enabled = configService.get<boolean>('ENABLE_GOOGLE_AUTH');
    super({
      clientID: enabled ? configService.get<string>('GOOGLE_CLIENT_ID') : 'disabled',
      clientSecret: enabled ? configService.get<string>('GOOGLE_CLIENT_SECRET') : 'disabled',
      callbackURL: enabled ? configService.get<string>('GOOGLE_CALLBACK_URL') : 'disabled',
      scope: ['email', 'profile'],
    });
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: (err: unknown, user: any) => void,
  ) {
    const email = profile.emails?.[0]?.value;
    const displayName = profile.displayName;

    // Validação para garantir que o email existe
    if (!email) {
      return done(new Error('Email não fornecido pelo Google'), null);
    }

    // Validação básica do formato do email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return done(new Error('Formato de email inválido'), null);
    }

    done(null, { email, displayName });
  }
}
