import { PrismaService } from '../prisma/prisma.service';
import { safeTimeZone } from './timezone.util';

/** Fuso da primeira unidade ativa do dono. Sem unidade, o padrão (São Paulo). */
export async function timeZoneForOwner(prisma: PrismaService, userId: number): Promise<string> {
  const shop = await prisma.barbershop.findFirst({
    where: { ownerUserId: userId, isActive: true },
    orderBy: { id: 'asc' },
    select: { timezone: true },
  });
  return safeTimeZone(shop?.timezone);
}
