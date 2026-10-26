import { PrismaService } from '../prisma/prisma.service';

type ReviewDb = Pick<PrismaService, 'review'>;

/**
 * Avaliação pelo link (ficha, sem conta) passa a ser a da conta, para o
 * login não criar outra (item 294). Se a conta já avaliou a unidade, a do
 * link fica como está.
 */
export async function claimFichaReviews(
  db: ReviewDb,
  clientAccountId: number,
  customerIds: number[],
) {
  if (!customerIds.length) return;
  const reviews = await db.review.findMany({
    where: { customerId: { in: customerIds }, clientAccountId: null },
    select: { id: true, barbershopId: true },
  });
  for (const review of reviews) {
    const taken = await db.review.findFirst({
      where: { barbershopId: review.barbershopId, clientAccountId },
      select: { id: true },
    });
    if (taken) continue;
    await db.review.update({
      where: { id: review.id },
      data: { clientAccountId },
    });
  }
}
