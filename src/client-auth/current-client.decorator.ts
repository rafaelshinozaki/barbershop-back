import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

export type CurrentClientUser = { id: number; email: string; name: string };

export const CurrentClient = createParamDecorator((_data: unknown, context: ExecutionContext): CurrentClientUser => {
  const gqlContext = GqlExecutionContext.create(context);
  const { req } = gqlContext.getContext();
  return req.clientUser;
});
