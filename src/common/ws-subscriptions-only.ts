import { GraphQLError, Kind, parse } from 'graphql';

/**
 * WebSocket (graphql-ws) só leva subscription. Query e mutation vão pelo
 * HTTP, onde passam pelo limite de requisições, pelo limite de tamanho da
 * consulta e, vindo do backoffice, pela lista de operações e pelo cargo de
 * quem pede. Sem isso, o mesmo socket aberto pra receber avisos executava
 * qualquer mutation sem nenhuma dessas travas.
 *
 * Retorna os erros que recusam a operação, ou undefined pra seguir.
 */
export function rejectNonSubscription(query: unknown): GraphQLError[] | undefined {
  if (typeof query !== 'string') return [new GraphQLError('Consulta inválida')];
  let doc;
  try {
    doc = parse(query);
  } catch {
    // Erro de sintaxe: o graphql-ws responde com o erro de validação
    return undefined;
  }
  const notSubscription = doc.definitions.some(
    (d) => d.kind === Kind.OPERATION_DEFINITION && d.operation !== 'subscription',
  );
  return notSubscription
    ? [new GraphQLError('Pelo WebSocket só vai subscription; use o HTTP')]
    : undefined;
}
