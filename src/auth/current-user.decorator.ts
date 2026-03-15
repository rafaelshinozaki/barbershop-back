// src/auth/current-user.decorator.ts
import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { UserDTO } from './users/dto/user.dto';
import { SmartLogger } from '../common/logger.util';

const logger = new SmartLogger('CurrentUserDecorator');

const getCurrentUserByContext = (context: ExecutionContext): UserDTO => {
  // Check if it's a GraphQL context
  if (context.getType<string>() === 'graphql') {
    const gqlContext = GqlExecutionContext.create(context);
    const contextData = gqlContext.getContext();

    // Log apenas informações essenciais
    logger.logEssential('GraphQL context data', contextData, ['user', 'req']);
    logger.logEssential('GraphQL context user', contextData.user, ['id', 'email']);
    logger.logEssential('GraphQL context req.user', contextData.req?.user, ['id', 'email']);

    return contextData.user || contextData.req?.user;
  }

  // REST context
  const user = context.switchToHttp().getRequest().user;
  logger.logEssential('REST context user', user, ['id', 'email']);
  return user;
};

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  getCurrentUserByContext(context),
);
