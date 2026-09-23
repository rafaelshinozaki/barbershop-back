import type { ApolloServerPlugin } from '@apollo/server';
import {
  DocumentNode,
  FragmentDefinitionNode,
  GraphQLError,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
} from 'graphql';

/**
 * Limites por operação GraphQL, checados antes de executar qualquer
 * resolver. Sem eles, uma única requisição (anônima, inclusive) podia pedir
 * a mesma consulta centenas de vezes com aliases
 * (`{ a1: publicBarbershop(slug: "x") { ... } a2: ... }`) ou aninhar
 * relações sem fim — o limite de requisições por IP não ajuda, é uma só.
 *
 * Calibrados pelas operações reais do front (medidas contra o schema): a
 * mais profunda tem 5 níveis e a maior pede 59 campos (a query `me`).
 */
export const MAX_QUERY_DEPTH = 8;
/** Campos pedidos na operação, contando cada alias e cada fragmento expandido. */
export const MAX_QUERY_FIELDS = 300;

type Fragments = Record<string, FragmentDefinitionNode>;

function measure(
  selectionSet: SelectionSetNode | undefined,
  fragments: Fragments,
  depth: number,
  visiting: Set<string>,
): { depth: number; fields: number } {
  if (!selectionSet) return { depth, fields: 0 };
  let maxDepth = depth;
  let fields = 0;
  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.FIELD) {
      // __typename (o Apollo Client pede em todo objeto) não custa nada
      if (sel.name.value === '__typename') continue;
      const inner = measure(sel.selectionSet, fragments, depth + 1, visiting);
      maxDepth = Math.max(maxDepth, sel.selectionSet ? inner.depth : depth + 1);
      fields += 1 + inner.fields;
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      const inner = measure(sel.selectionSet, fragments, depth, visiting);
      maxDepth = Math.max(maxDepth, inner.depth);
      fields += inner.fields;
    } else {
      const name = sel.name.value;
      // Fragmento que se inclui (a validação do GraphQL também recusa)
      if (visiting.has(name)) continue;
      visiting.add(name);
      const inner = measure(fragments[name]?.selectionSet, fragments, depth, visiting);
      visiting.delete(name);
      maxDepth = Math.max(maxDepth, inner.depth);
      fields += inner.fields;
    }
  }
  return { depth: maxDepth, fields };
}

export function measureOperation(document: DocumentNode, operation: OperationDefinitionNode) {
  const fragments: Fragments = {};
  for (const def of document.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) fragments[def.name.value] = def;
  }
  return measure(operation.selectionSet, fragments, 0, new Set());
}

export function queryLimitsPlugin(): ApolloServerPlugin {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation({ document, operation }) {
          if (!operation) return;
          const { depth, fields } = measureOperation(document, operation);
          if (depth > MAX_QUERY_DEPTH) {
            throw new GraphQLError(
              `Consulta muito profunda (${depth} níveis; máximo ${MAX_QUERY_DEPTH}).`,
              { extensions: { code: 'QUERY_TOO_DEEP', http: { status: 400 } } },
            );
          }
          if (fields > MAX_QUERY_FIELDS) {
            throw new GraphQLError(
              `Consulta pede campos demais (${fields}; máximo ${MAX_QUERY_FIELDS}).`,
              { extensions: { code: 'QUERY_TOO_COMPLEX', http: { status: 400 } } },
            );
          }
        },
      };
    },
  };
}
