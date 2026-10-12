import { ExecutionContext, Injectable } from '@nestjs/common';
import { GraphQLClientJwtAuthGuard } from './graphql-client-jwt-auth.guard';

/**
 * Como o guard do cliente, mas sem sessão (ou com sessão inválida) a query
 * segue sem `clientUser` em vez de dar erro. Pra checar se há cliente logado
 * nas páginas públicas sem gerar erro a cada visita anônima.
 */
@Injectable()
export class OptionalClientJwtAuthGuard extends GraphQLClientJwtAuthGuard {
  async canActivate(context: ExecutionContext) {
    try {
      return await super.canActivate(context);
    } catch {
      return true;
    }
  }
}
