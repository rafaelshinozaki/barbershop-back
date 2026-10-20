import { PrismaService } from '../prisma/prisma.service';

/**
 * Sessão derrubada ou conta desativada: o link secreto da agenda (iCal) sai
 * junto. O app de calendário busca esse endereço sem login, então derrubar
 * a sessão sozinha não para o nome e o telefone dos clientes.
 */
export async function dropCalendarFeeds(
  db: Pick<PrismaService, 'calendarFeed'>,
  userIds: number | number[],
) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter((id) => Number.isInteger(id));
  if (!ids.length) return 0;
  const { count } = await db.calendarFeed.deleteMany({ where: { userId: { in: ids } } });
  return count;
}
