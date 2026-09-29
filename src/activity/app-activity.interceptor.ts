import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { randomUUID } from 'crypto';
import type { GraphQLResolveInfo } from 'graphql';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { isBackofficeOnly } from '../auth/guards/roles.guard';
import type { Role } from '../auth/interfaces/roles';
import { entityFromOperation, errorType, idsFromArgs, type AppActivityEvent } from './app-activity';
import { AppActivityService } from './app-activity.service';

type Req = {
  method?: string;
  url?: string;
  route?: { path?: string };
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  params?: unknown;
  user?: { id?: number; role?: { name?: string } | string };
  clientUser?: { id?: number };
};

/**
 * Trilha do app: toda escrita (mutation ou REST que não é GET) de quem usa o
 * app vira um evento pro Axiom. As do backoffice ficam de fora (já vão pro
 * BackofficeAuditLog). Não segura a resposta; sem AXIOM_TOKEN, não faz nada.
 */
@Injectable()
export class AppActivityInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly activity: AppActivityService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.activity.enabled) return next.handle();
    const roles =
      this.reflector.getAllAndOverride<Role[]>('roles', [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (isBackofficeOnly(roles)) return next.handle();
    const call = this.describe(context);
    if (!call) return next.handle();

    const save = (success: boolean, result?: unknown, error?: unknown) => {
      const { req } = call;
      const ids = idsFromArgs(call.args);
      const resultId =
        result && typeof result === 'object' && typeof (result as { id?: unknown }).id === 'number'
          ? (result as { id: number }).id
          : null;
      const user = req?.user;
      const role = typeof user?.role === 'string' ? user.role : user?.role?.name ?? null;
      const header = req?.headers?.['x-request-id'];
      const event: AppActivityEvent = {
        _time: new Date().toISOString(),
        requestId: (typeof header === 'string' && header.slice(0, 100)) || randomUUID(),
        actorType: user?.id != null ? 'user' : req?.clientUser?.id != null ? 'client' : 'anonymous',
        actorId: user?.id ?? req?.clientUser?.id ?? null,
        role,
        barbershopId: ids.barbershopId,
        operation: call.operation,
        entityType: ids.entityType ?? entityFromOperation(call.name),
        entityId: ids.entityId ?? resultId,
        success,
        errorType: error === undefined ? null : errorType(error),
      };
      this.activity.record(event);
    };

    return next.handle().pipe(
      tap((result) => save(true, result)),
      catchError((error: unknown) => {
        save(false, undefined, error);
        return throwError(() => error);
      }),
    );
  }

  private describe(
    context: ExecutionContext,
  ): { operation: string; name: string; args: unknown; req?: Req } | undefined {
    if (context.getType<string>() === 'graphql') {
      const gql = GqlExecutionContext.create(context);
      const info = gql.getInfo<GraphQLResolveInfo>();
      if (info?.parentType?.name !== 'Mutation') return undefined;
      return {
        operation: info.fieldName,
        name: info.fieldName,
        args: gql.getArgs(),
        req: gql.getContext<{ req?: Req }>().req,
      };
    }
    const req = context.switchToHttp().getRequest<Req>();
    if (!req?.method || req.method === 'GET' || req.method === 'HEAD') return undefined;
    const path = req.route?.path ?? req.url?.split('?')[0] ?? '';
    return {
      operation: `${req.method} ${path}`,
      name: path.split('/').filter(Boolean).pop() ?? '',
      args: { params: req.params, body: req.body },
      req,
    };
  }
}
