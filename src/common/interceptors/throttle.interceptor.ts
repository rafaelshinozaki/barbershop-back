import { Injectable, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ThrottlerException } from '@nestjs/throttler';

@Injectable()
export class ThrottleInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        if (error instanceof ThrottlerException) {
          const response = context.switchToHttp().getResponse();
          const request = context.switchToHttp().getRequest();

          // Determinar o tipo de endpoint baseado na URL
          let message = 'Too many requests. Please try again later.';

          if (request.url.includes('/auth/login')) {
            message = 'Too many login attempts. Please wait 5 minutes before trying again.';
          } else if (
            request.url.includes('/user/forgot-password') ||
            request.url.includes('/user/forgot-pass')
          ) {
            message =
              'Too many password reset requests. Please wait 15 minutes before trying again.';
          } else if (request.url.includes('/user/create')) {
            message =
              'Too many account creation attempts. Please wait 1 minute before trying again.';
          } else if (
            request.url.includes('/user/change-password-request') ||
            request.url.includes('/user/two-factor-request')
          ) {
            message = 'Too many email requests. Please wait 1 hour before trying again.';
          }

          return throwError(() => ({
            statusCode: 429,
            message,
            error: 'Too Many Requests',
          }));
        }

        return throwError(() => error);
      }),
    );
  }
}
