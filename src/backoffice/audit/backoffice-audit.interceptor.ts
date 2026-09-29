import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { GraphQLResolveInfo } from 'graphql';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { BACKOFFICE_AREA_KEY } from '../../auth/backoffice-areas';
import { isBackofficeOnly } from '../../auth/guards/roles.guard';
import { Role } from '../../auth/interfaces/roles';
import { BackofficeAuditService } from './backoffice-audit.service';

type Actor = { id?: number; email?: string; role?: { name?: string } | string };

/**
 * Registro de ações do backoffice: toda escrita de operação só da equipe do
 * sistema (mutation GraphQL ou rota REST que não é GET) vira uma linha em
 * BackofficeAuditLog, com quem fez, os dados (sem segredos) e se deu certo.
 * Roda depois dos guards, então só registra quem passou por eles. Global:
 * operação nova do backoffice entra sozinha.
 */
@Injectable()
export class BackofficeAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: BackofficeAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', targets) ?? [];
    if (!isBackofficeOnly(roles)) return next.handle();

    const call = this.describe(context);
    if (!call) return next.handle();
    const area = this.reflector.getAllAndOverride<string>(BACKOFFICE_AREA_KEY, targets);
    const role = typeof call.actor?.role === 'string' ? call.actor.role : call.actor?.role?.name;
    const save = (success: boolean, error?: string) =>
      void this.audit.record({
        actorId: call.actor?.id ?? null,
        actorEmail: call.actor?.email ?? null,
        actorRole: role ?? null,
        operation: call.operation,
        area: area ?? null,
        args: call.args,
        success,
        error,
        requestId: call.requestId ?? null,
      });

    return next.handle().pipe(
      tap(() => save(true)),
      catchError((err: unknown) => {
        save(false, err instanceof Error ? err.message : String(err));
        return throwError(() => err);
      }),
    );
  }

  /** Operação, dados e quem chamou; undefined = leitura (não registra). */
  private describe(
    context: ExecutionContext,
  ): { operation: string; args: unknown; actor?: Actor; requestId?: string } | undefined {
    if (context.getType<string>() === 'graphql') {
      const gql = GqlExecutionContext.create(context);
      const info = gql.getInfo<GraphQLResolveInfo>();
      if (info?.parentType?.name !== 'Mutation') return undefined;
      const ctx = gql.getContext<{
        req?: { user?: Actor; backofficeActor?: Actor; requestId?: string };
        user?: Actor;
      }>();
      return {
        operation: info.fieldName,
        args: gql.getArgs(),
        actor: ctx.req?.backofficeActor ?? ctx.user ?? ctx.req?.user,
        requestId: ctx.req?.requestId,
      };
    }
    const req = context.switchToHttp().getRequest<{
      method: string;
      route?: { path?: string };
      url: string;
      body?: unknown;
      params?: unknown;
      user?: Actor;
      backofficeActor?: Actor;
      requestId?: string;
    }>();
    if (!req || req.method === 'GET' || req.method === 'HEAD') return undefined;
    const params = req.params as Record<string, unknown> | undefined;
    return {
      operation: `${req.method} ${req.route?.path ?? req.url.split('?')[0]}`,
      args: params && Object.keys(params).length ? { params, body: req.body } : req.body,
      actor: req.backofficeActor ?? req.user,
      requestId: req.requestId,
    };
  }
}
