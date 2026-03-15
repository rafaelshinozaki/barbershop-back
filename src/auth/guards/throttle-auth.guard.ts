import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class ThrottleAuthGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Handle both HTTP and GraphQL contexts
    let ip = 'unknown';
    let userAgent = 'unknown';

    try {
      if (req) {
        // HTTP context
        ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
        userAgent = req.headers?.['user-agent'] || 'unknown';
      }
    } catch (error) {
      console.warn('Error getting request info for throttling:', error);
    }

    return `${ip}-${userAgent}`;
  }

  protected getRequestResponse(context: ExecutionContext) {
    const gqlContext = GqlExecutionContext.create(context);
    const ctx = gqlContext.getContext();
    return { req: ctx.req, res: ctx.res };
  }
}
