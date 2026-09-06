import { Injectable, ExecutionContext, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

@Injectable()
export class ClientFacebookAuthGuard extends AuthGuard('facebook-client') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    if (this.configService.get<boolean>('DISABLE_SOCIAL_SSO')) {
      throw new NotFoundException();
    }
    return super.canActivate(context);
  }
}
