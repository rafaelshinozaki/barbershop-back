import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

// Estratégia separada da GoogleStrategy de staff (mesmo client ID/secret do
// Google, já que um único app OAuth pode ter várias redirect URIs
// autorizadas) — mas com nome e callbackURL próprios, porque o destino é uma
// ClientAccount, não um User de staff.
@Injectable()
export class ClientGoogleStrategy extends PassportStrategy(Strategy, 'google-client') {
  constructor(configService: ConfigService) {
    const enabled = configService.get<boolean>('ENABLE_GOOGLE_AUTH');
    super({
      clientID: enabled ? configService.get<string>('GOOGLE_CLIENT_ID') : 'disabled',
      clientSecret: enabled ? configService.get<string>('GOOGLE_CLIENT_SECRET') : 'disabled',
      callbackURL: enabled ? configService.get<string>('GOOGLE_CLIENT_CALLBACK_URL') : 'disabled',
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

    if (!email) {
      return done(new Error('Email não fornecido pelo Google'), null);
    }

    done(null, { email, displayName });
  }
}
