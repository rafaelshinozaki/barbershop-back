import { Catch, HttpException } from '@nestjs/common';
import { GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

/**
 * Apollo Server 4 masks any thrown error that isn't already a GraphQLError as
 * a generic "Internal server error", discarding the original message and
 * status — so intentional HttpExceptions (e.g. "User already exists") never
 * reach the client. This filter re-wraps them as GraphQLError so the real
 * message and status survive.
 */
@Catch(HttpException)
export class GqlHttpExceptionFilter implements GqlExceptionFilter {
  catch(exception: HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const message =
      typeof response === 'string' ? response : ((response as any)?.message ?? exception.message);

    return new GraphQLError(Array.isArray(message) ? message.join(', ') : message, {
      extensions: { code: status },
    });
  }
}
