import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClientFacebookStrategy extends PassportStrategy(Strategy, 'facebook-client') {
  constructor(configService: ConfigService) {
    const enabled = configService.get<boolean>('ENABLE_FACEBOOK_AUTH');
    super({
      clientID: enabled ? configService.get<string>('FACEBOOK_CLIENT_ID') : 'disabled',
      clientSecret: enabled ? configService.get<string>('FACEBOOK_CLIENT_SECRET') : 'disabled',
      callbackURL: enabled ? configService.get<string>('FACEBOOK_CLIENT_CALLBACK_URL') : 'disabled',
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
