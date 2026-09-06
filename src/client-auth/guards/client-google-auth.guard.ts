import { Injectable, ExecutionContext, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

@Injectable()
export class ClientGoogleAuthGuard extends AuthGuard('google-client') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    if (!this.configService.get<boolean>('ENABLE_GOOGLE_AUTH')) {
      throw new NotFoundException();
    }
    return super.canActivate(context);
  }
}
