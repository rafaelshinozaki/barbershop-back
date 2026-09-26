import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/** A pessoa que atende. Duas unidades criando ao mesmo tempo compartilham a mesma linha. */
export async function ensureProfessional(db: Db, userId: number) {
  const existing = await db.professional.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    return await db.professional.create({ data: { userId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return db.professional.findUniqueOrThrow({ where: { userId } });
    }
    throw error;
  }
}

/** Liga este vínculo e os outros da mesma conta que ainda não tinham identidade. */
export async function linkBarberToProfessional(db: Db, barberId: number, userId: number) {
  const professional = await ensureProfessional(db, userId);
  await db.barber.updateMany({
    where: { userId, professionalId: null },
    data: { professionalId: professional.id },
  });
  await db.barber.update({
    where: { id: barberId },
    data: { userId, professionalId: professional.id },
  });
  return professional;
}

/** "09:00" em minutos desde meia-noite. */
export function minutesOfDay(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + (minute || 0);
}

/** Dois turnos do mesmo dia se cruzam. */
export function shiftsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const start = minutesOfDay(aStart);
  const end = minutesOfDay(aEnd);
  const otherStart = minutesOfDay(bStart);
  const otherEnd = minutesOfDay(bEnd);
  return start < otherEnd && end > otherStart;
}
