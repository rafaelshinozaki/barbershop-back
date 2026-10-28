import { Injectable, ExecutionContext, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { assertStaffOAuthState, staffOAuthStateOptions } from '../oauth-state';
import { isAppleConfigured } from '../interfaces/apple-config.util';

@Injectable()
export class AppleAuthGuard extends AuthGuard('apple') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    if (!isAppleConfigured(this.configService)) {
      throw new NotFoundException();
    }
    assertStaffOAuthState(context);
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    return staffOAuthStateOptions(context);
  }
}
