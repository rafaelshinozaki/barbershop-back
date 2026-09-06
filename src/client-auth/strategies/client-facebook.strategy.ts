import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClientFacebookStrategy extends PassportStrategy(Strategy, 'facebook-client') {
  constructor(configService: ConfigService) {
    const disabled = configService.get<boolean>('DISABLE_SOCIAL_SSO');
    super({
      clientID: disabled ? 'disabled' : configService.get<string>('FACEBOOK_CLIENT_ID'),
      clientSecret: disabled ? 'disabled' : configService.get<string>('FACEBOOK_CLIENT_SECRET'),
      callbackURL: disabled ? 'disabled' : configService.get<string>('FACEBOOK_CLIENT_CALLBACK_URL'),
      profileFields: ['id', 'emails', 'displayName'],
      scope: ['email'],
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
      return done(new Error('Email não fornecido pelo Facebook'), null);
    }

    done(null, { email, displayName });
  }
}
