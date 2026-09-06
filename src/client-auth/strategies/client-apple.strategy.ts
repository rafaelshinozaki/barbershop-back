import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-apple';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { isAppleConfigured } from '@/auth/interfaces/apple-config.util';

@Injectable()
export class ClientAppleStrategy extends PassportStrategy(Strategy, 'apple-client') {
  constructor(configService: ConfigService) {
    const configured = isAppleConfigured(configService, 'APPLE_CLIENT_CALLBACK_URL');
    super({
      clientID: configured ? configService.get<string>('APPLE_CLIENT_ID') : 'disabled',
      teamID: configured ? configService.get<string>('APPLE_TEAM_ID') : 'disabled',
      keyID: configured ? configService.get<string>('APPLE_KEY_ID') : 'disabled',
      privateKeyString: configured
        ? configService.get<string>('APPLE_PRIVATE_KEY')?.replace(/\\n/g, '\n')
        : 'disabled',
      callbackURL: configured ? configService.get<string>('APPLE_CLIENT_CALLBACK_URL') : 'disabled',
    });
  }

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

      const displayName = req.appleProfile?.name
        ? `${req.appleProfile.name.firstName ?? ''} ${req.appleProfile.name.lastName ?? ''}`.trim()
        : email.split('@')[0];

      done(null, { email, displayName });
    } catch (error) {
      done(error, null);
    }
  }
}
