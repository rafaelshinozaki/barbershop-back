import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import * as Sentry from '@sentry/nestjs';
import { GraphQLError, type GraphQLResolveInfo } from 'graphql';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { slowRequestMs } from './sentry-options';

/** Erro esperado (entrada inválida, sem login, sem permissão): não é bug */
const USER_ERROR_CODES = [
  'BAD_USER_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'GRAPHQL_VALIDATION_FAILED',
];

export function shouldReport(error: unknown): boolean {
  if (error instanceof HttpException) return error.getStatus() >= 500;
  if (error instanceof GraphQLError) {
    const code = error.extensions?.code;
    return !(typeof code === 'string' && USER_ERROR_CODES.includes(code));
  }
  return true;
}

type Actor = { id?: number };

/**
 * Manda pro Sentry o que quebrou (exceção inesperada, 5xx) e o request lento,
 * com a operação e o id de quem chamou (nada além do id). Sem SENTRY_DSN o
 * Sentry não está ligado e isto não faz nada.
 */
@Injectable()
export class SentryInterceptor implements NestInterceptor {
  private readonly slowMs = slowRequestMs(process.env);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!Sentry.getClient()) return next.handle();
    const { operation, actor } = this.describe(context);
    const started = Date.now();
    const withScope = (fn: (scope: Sentry.Scope) => void) =>
      Sentry.withScope((scope) => {
        scope.setTag('operation', operation);
        if (actor?.id != null) scope.setUser({ id: String(actor.id) });
        fn(scope);
      });

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - started;
        if (ms >= this.slowMs) {
          withScope((scope) => {
            scope.setExtra('durationMs', ms);
            Sentry.captureMessage(`Request lento: ${operation} (${ms} ms)`, 'warning');
          });
        }
      }),
      catchError((error: unknown) => {
        if (shouldReport(error)) withScope(() => Sentry.captureException(error));
        return throwError(() => error);
      }),
    );
  }

  private describe(context: ExecutionContext): { operation: string; actor?: Actor } {
    if (context.getType<string>() === 'graphql') {
      const gql = GqlExecutionContext.create(context);
      const info = gql.getInfo<GraphQLResolveInfo>();
      const ctx = gql.getContext<{ req?: { user?: Actor } }>();
      return {
        operation: `${info?.parentType?.name ?? 'GraphQL'}.${info?.fieldName ?? '?'}`,
        actor: ctx.req?.user,
      };
    }
    const req = context
      .switchToHttp()
      .getRequest<{ method?: string; route?: { path?: string }; url?: string; user?: Actor }>();
    return {
      operation: `${req?.method ?? ''} ${req?.route?.path ?? req?.url?.split('?')[0] ?? ''}`.trim(),
      actor: req?.user,
    };
  }
}
