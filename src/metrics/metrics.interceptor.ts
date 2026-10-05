import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { GraphQLResolveInfo } from 'graphql';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { shouldReport } from '../common/sentry/sentry.interceptor';
import { MetricsService } from './metrics.service';

const ROOTS = new Set(['Query', 'Mutation']);

/**
 * Tempo de cada operação pras métricas do minuto. Conta como erro só o que
 * é bug ou falha (o mesmo critério do Sentry): senha errada, sem permissão
 * e validação são respostas esperadas, não incidente.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const operation = this.operation(context);
    if (!operation) return next.handle();
    const started = performance.now();
    return next.handle().pipe(
      tap(() => this.metrics.recorder.record(operation, performance.now() - started, true)),
      catchError((error: unknown) => {
        this.metrics.recorder.record(operation, performance.now() - started, !shouldReport(error));
        return throwError(() => error);
      }),
    );
  }

  /** "Query.searchBarbershops", "POST /stripe/webhook"; campo aninhado: não conta */
  private operation(context: ExecutionContext): string | null {
    if (context.getType<string>() === 'graphql') {
      const info = GqlExecutionContext.create(context).getInfo<GraphQLResolveInfo>();
      const parent = info?.parentType?.name;
      return parent && ROOTS.has(parent) ? `${parent}.${info.fieldName}` : null;
    }
    if (context.getType() !== 'http') return null;
    const req = context.switchToHttp().getRequest<{ method?: string; route?: { path?: string } }>();
    return req?.route?.path ? `${req.method} ${req.route.path}` : null;
  }
}
