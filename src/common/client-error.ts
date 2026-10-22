import { HttpException } from '@nestjs/common';

/**
 * Texto de um erro que a aplicação lançou de propósito (HttpException).
 * Qualquer outro erro — Stripe, banco, rede — fica no log; a resposta leva
 * o texto genérico, sem a mensagem interna.
 */
export function clientErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    const message =
      typeof body === 'string'
        ? body
        : body && typeof body === 'object' && 'message' in body
        ? (body as { message: unknown }).message
        : undefined;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message) && typeof message[0] === 'string' && message[0].trim()) {
      return message[0];
    }
  }
  return fallback;
}
