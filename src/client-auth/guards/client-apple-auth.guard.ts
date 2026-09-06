import { Injectable, ExecutionContext, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { isAppleConfigured } from '@/auth/interfaces/apple-config.util';

@Injectable()
export class ClientAppleAuthGuard extends AuthGuard('apple-client') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    if (!isAppleConfigured(this.configService, 'APPLE_CLIENT_CALLBACK_URL')) {
      throw new NotFoundException();
    }
    return super.canActivate(context);
  }
}
