import { Prisma } from '@prisma/client';

/**
 * Atualização de uma avaliação que já existe. Se o texto mudou, a denúncia
 * era sobre a versão anterior (sai da fila) e a resposta da unidade fica
 * marcada como feita para aquele texto.
 */
export function reviewEditData(
  existing: { comment: string | null; reply: string | null } | null,
  next: { rating: number; comment: string | null },
): Prisma.ReviewUpdateInput {
  const commentChanged =
    existing != null && (existing.comment ?? '').trim() !== (next.comment ?? '').trim();
  return {
    rating: next.rating,
    comment: next.comment,
    ...(commentChanged
      ? {
          reportedAt: null,
          reportReason: null,
          ...(existing.reply ? { replyStale: true } : {}),
        }
      : {}),
  };
}
