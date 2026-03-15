// src\auth\session.serializer.ts
import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  serializeUser(user: any, done: (err: Error, user: any) => void): any {
    // console.log('Serializing user:', user);
    done(null, user);
  }

  deserializeUser(payload: any, done: (err: Error, payload: string) => void): any {
    // console.log('Deserializing user:', payload);
    done(null, payload);
  }
}
