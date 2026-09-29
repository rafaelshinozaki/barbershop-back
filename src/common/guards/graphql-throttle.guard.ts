import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GqlExecutionContext } from '@nestjs/graphql';

/**
 * Testes E2E (várias sessões seguidas do mesmo IP) desligam o limite com
 * THROTTLE_DISABLED=true. Em produção nunca: a variável é ignorada.
 */
export function throttleDisabled(env: NodeJS.ProcessEnv = process.env) {
  return env.THROTTLE_DISABLED === 'true' && env.NODE_ENV !== 'production';
}

@Injectable()
export class GraphQLThrottleGuard extends ThrottlerGuard {
  // Subscription (WebSocket) não tem resposta HTTP pra pôr os headers de
  // rate limit — o guard base quebrava com "reading 'header'". O socket já
  // exige login e origem permitida no handshake (app.module.ts), e cada
  // subscription é uma conexão longa, não uma rajada de requisições.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (throttleDisabled()) return true;
    if (
      context.getType<'http' | 'graphql'>() === 'graphql' &&
      GqlExecutionContext.create(context).getInfo()?.operation?.operation === 'subscription'
    ) {
      return true;
    }
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Só o IP. Antes a chave era IP + User-Agent, e o User-Agent é o cliente
    // que manda: trocar o header a cada requisição zerava o contador e
    // furava todos os limites (agendamento público, esqueci a senha,
    // suporte...). Atrás de proxy, req.ip já vem certo pelo "trust proxy"
    // (main.ts); o X-Forwarded-For não é lido direto porque também é do cliente.
    try {
      return req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress || 'unknown';
    } catch (error) {
      new Logger(GraphQLThrottleGuard.name).warn(
        `Error getting request info for GraphQL throttling: ${error}`,
      );
      return 'unknown';
    }
  }

  protected getRequestResponse(context: ExecutionContext) {
    // GqlExecutionContext.create() nunca lança exceção mesmo para uma rota
    // REST comum — ela só embrulha o que quer que seja o contexto recebido,
    // então tentar pegar req/res dela para uma request REST silenciosamente
    // devolvia undefined (sem erro nenhum) em vez de cair no catch/fallback
    // abaixo, e o ThrottlerGuard base quebrava tentando chamar res.header()
    // num res undefined. Precisa checar o tipo real do contexto antes.
    if (context.getType<'http' | 'graphql'>() === 'graphql') {
      const gqlContext = GqlExecutionContext.create(context);
      const ctx = gqlContext.getContext();
      return { req: ctx.req, res: ctx.res };
    }

    const httpContext = context.switchToHttp();
    return { req: httpContext.getRequest(), res: httpContext.getResponse() };
  }
}
