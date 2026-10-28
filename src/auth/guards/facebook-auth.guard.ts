import { Injectable, ExecutionContext, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { assertStaffOAuthState, staffOAuthStateOptions } from '../oauth-state';

@Injectable()
export class FacebookAuthGuard extends AuthGuard('facebook') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    if (!this.configService.get<boolean>('ENABLE_FACEBOOK_AUTH')) {
      throw new NotFoundException();
    }
    assertStaffOAuthState(context);
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    return staffOAuthStateOptions(context);
  }
}
