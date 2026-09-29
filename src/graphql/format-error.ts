import { unwrapResolverError } from '@apollo/server/errors';
import { Prisma } from '@prisma/client';
import type { GraphQLFormattedError } from 'graphql';

/**
 * Resposta de erro do GraphQL: só campos serializáveis (evita "Converting
 * circular structure to JSON") e nunca o texto interno do banco. Um erro do
 * Prisma (data inválida, por exemplo) saía inteiro pro cliente: caminho do
 * arquivo no servidor, linha e a consulta montada. Dado inválido vira
 * BAD_USER_INPUT; o resto do banco, erro interno genérico.
 */
export function formatGqlError(
  formattedError: GraphQLFormattedError,
  error?: unknown,
): GraphQLFormattedError {
  try {
    const where = { locations: formattedError.locations, path: formattedError.path };
    const original = error === undefined ? undefined : unwrapResolverError(error);
    if (original instanceof Prisma.PrismaClientValidationError) {
      return { message: 'Dados inválidos', ...where, extensions: { code: 'BAD_USER_INPUT' } };
    }
    if (
      original instanceof Prisma.PrismaClientKnownRequestError ||
      original instanceof Prisma.PrismaClientUnknownRequestError ||
      original instanceof Prisma.PrismaClientRustPanicError ||
      original instanceof Prisma.PrismaClientInitializationError
    ) {
      return {
        message: 'Erro interno. Tente de novo.',
        ...where,
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      };
    }
    const ext = formattedError.extensions as Record<string, unknown> | undefined;
    const code =
      typeof ext?.code === 'string' || typeof ext?.code === 'number' ? ext.code : undefined;
    return {
      message: String(formattedError.message ?? 'Internal server error'),
      ...where,
      extensions: code !== undefined ? { code } : undefined,
    };
  } catch {
    return { message: 'Internal server error' };
  }
}
