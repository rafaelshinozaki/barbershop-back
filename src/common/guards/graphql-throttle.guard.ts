import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class GraphQLThrottleGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Handle GraphQL context safely
    let ip = 'unknown';
    let userAgent = 'unknown';

    try {
      if (req && req.headers) {
        // Try to get IP from various sources
        ip =
          req.ip ||
          req.connection?.remoteAddress ||
          req.socket?.remoteAddress ||
          (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : null) ||
          'unknown';

        userAgent = req.headers['user-agent'] || 'unknown';
      }
    } catch (error) {
      console.warn('Error getting request info for GraphQL throttling:', error);
    }

    return `${ip}-${userAgent}`;
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
