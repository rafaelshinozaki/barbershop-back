import { Injectable, ExecutionContext, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
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
    return super.canActivate(context);
  }
}
