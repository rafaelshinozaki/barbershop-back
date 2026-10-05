import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { isSystemRole } from '../auth/backoffice-areas';
import { gatewayAllowed } from '../auth/guards/roles.guard';
import { requestContext, type ChangeActor } from './request-context';

type ActorReq = {
  headers?: Record<string, string | string[] | undefined>;
  user?: { id?: number; fullName?: string | null; role?: { name?: string } | string | null };
  clientUser?: { id?: number; name?: string | null };
};

/** Motivo informado na operação (reason no topo ou no input), pro histórico */
export function reasonFromArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const top = args as Record<string, unknown>;
  const input =
    top.input && typeof top.input === 'object' ? (top.input as Record<string, unknown>) : {};
  const reason = top.reason ?? input.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
}

/**
 * Quem está agindo, pelo que o login (guards) pôs no request: conta do app,
 * cliente final ou equipe da plataforma. Vindo da API do backoffice (segredo
 * certo), a origem é "backoffice".
 */
export function actorFromRequest(
  req: ActorReq | undefined,
  args?: unknown,
): ChangeActor | undefined {
  if (!req) return undefined;
  const secret = process.env.BACKOFFICE_GATEWAY_SECRET;
  const origin: ChangeActor['origin'] =
    secret && gatewayAllowed(secret, req.headers?.['x-backoffice-gateway']) ? 'backoffice' : 'app';
  const reason = reasonFromArgs(args);
  const user = req.user;
  if (user?.id != null) {
    const role = typeof user.role === 'string' ? user.role : user.role?.name ?? null;
    return {
      type: isSystemRole(role ?? undefined) ? 'staff' : 'user',
      id: user.id,
      name: user.fullName ?? null,
      role,
      origin: isSystemRole(role ?? undefined) ? 'backoffice' : origin,
      reason,
    };
  }
  const client = req.clientUser;
  if (client?.id != null) {
    return {
      type: 'client',
      id: client.id,
      name: client.name ?? null,
      role: 'Client',
      origin,
      reason,
    };
  }
  return undefined;
}

/**
 * Depois dos guards, põe no contexto do request quem está agindo. O
 * PrismaService leva isso pro set_config da transação e o gatilho do
 * histórico de alterações grava.
 */
@Injectable()
export class ChangeActorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<string>() === 'graphql') {
      const gql = GqlExecutionContext.create(context);
      const ctx = gql.getContext<{ req?: ActorReq }>();
      const actor = actorFromRequest(ctx.req, gql.getArgs());
      if (actor) requestContext.setActor(actor);
    } else if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<ActorReq & { body?: unknown }>();
      const actor = actorFromRequest(req, req?.body);
      if (actor) requestContext.setActor(actor);
    }
    return next.handle();
  }
}
