import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { extendProUntil } from './pro';

type Db = Pick<PrismaService, 'proReferral' | 'appointment' | '$transaction'>;

/**
 * A conta indicada já atendeu de verdade: um horário concluído, que já
 * terminou, de um cliente que agendou pela página ou tem conta de cliente
 * (item 239). Conta criada só para usar o código não chega aqui.
 */
export function realAppointmentWhere(
  invitedUserId: number,
  now: Date,
): Prisma.AppointmentWhereInput {
  return {
    status: 'COMPLETED',
    endAt: { lte: now },
    barber: { userId: invitedUserId },
    OR: [{ source: 'ONLINE' }, { customer: { clientAccountId: { not: null } } }],
  };
}

/**
 * Libera os meses de quem indicou cujas contas indicadas já atenderam. Cada
 * indicação é liberada uma vez só (updateMany condicional), e o fim do Pro
 * é lido e gravado com a linha travada, como no aceite do código.
 */
export async function releaseInviterMonths(db: Db, inviterUserId: number, now = new Date()) {
  const pending = await db.proReferral.findMany({
    where: { inviterUserId, inviterGrantedAt: null },
    select: { id: true, invitedUserId: true, months: true },
  });
  let released = 0;
  for (const referral of pending) {
    const active = await db.appointment.findFirst({
      where: realAppointmentWhere(referral.invitedUserId, now),
      select: { id: true },
    });
    if (!active) continue;
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pro-until:${inviterUserId}`}))`;
      const claimed = await tx.proReferral.updateMany({
        where: { id: referral.id, inviterGrantedAt: null },
        data: { inviterGrantedAt: now },
      });
      if (claimed.count !== 1) return;
      const rows = await tx.$queryRaw<{ proUntil: Date | null }[]>`
        SELECT "proUntil" FROM "User" WHERE id = ${inviterUserId} FOR UPDATE
      `;
      await tx.user.update({
        where: { id: inviterUserId },
        data: { proUntil: extendProUntil(rows[0]?.proUntil, referral.months, now) },
      });
      released++;
    });
  }
  return released;
}
