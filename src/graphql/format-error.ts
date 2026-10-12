import { unwrapResolverError } from '@apollo/server/errors';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GraphQLFormattedError } from 'graphql';
import { errorReasonOf } from '../common/error-reasons';

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
      return {
        message: 'Dados inválidos',
        ...where,
        extensions: { code: 'BAD_USER_INPUT', reason: 'INVALID_INPUT' },
      };
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
    // Validação do DTO (ValidationPipe): o texto vinha "Bad Request Exception",
    // sem dizer o campo. Vai a primeira mensagem da validação; a que não está
    // no catálogo leva o código genérico INVALID_INPUT
    const validation = validationMessageOf(original);
    const message = validation ?? String(formattedError.message ?? 'Internal server error');
    // `code` continua sendo a categoria (FORBIDDEN, BAD_REQUEST…); `reason` diz
    // qual erro foi, pro front traduzir (ver error-reasons.ts)
    const reason = errorReasonOf(message) ?? (validation ? 'INVALID_INPUT' : undefined);
    const extensions = {
      ...(code !== undefined ? { code } : {}),
      ...(reason ? { reason } : {}),
    };
    return {
      message,
      ...where,
      extensions: Object.keys(extensions).length ? extensions : undefined,
    };
  } catch {
    return { message: 'Internal server error' };
  }
}

const validationMessageOf = (error: unknown): string | undefined => {
  if (!(error instanceof BadRequestException)) return undefined;
  const response = error.getResponse();
  const messages =
    typeof response === 'object' && response !== null
      ? (response as { message?: unknown }).message
      : undefined;
  return Array.isArray(messages) && typeof messages[0] === 'string' ? messages[0] : undefined;
};
