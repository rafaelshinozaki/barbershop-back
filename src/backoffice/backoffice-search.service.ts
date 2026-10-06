import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type SearchHit = {
  kind: 'user' | 'barbershop' | 'client';
  id: number;
  title: string;
  subtitle: string | null;
};

const LIMIT = 6;

/**
 * Busca única do topo do backoffice: um texto (e-mail, nome, unidade ou
 * número) e o que bater, por tipo. Só os tipos das áreas de quem busca:
 * contas e unidades com Usuários, contas de cliente com Suporte.
 */
@Injectable()
export class BackofficeSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(text: string, can: { users: boolean; clients: boolean }): Promise<SearchHit[]> {
    const q = text.trim().slice(0, 100);
    if (q.length < 2 && !/^\d+$/.test(q)) return [];
    const id = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
    const safeId = id != null && id > 0 && id < 2 ** 31 ? id : null;
    const contains = { contains: q, mode: 'insensitive' as const };

    const [users, shops, clients] = await Promise.all([
      can.users
        ? this.prisma.user.findMany({
            where: {
              deleted_at: null,
              OR: [
                { email: contains },
                { fullName: contains },
                ...(safeId ? [{ id: safeId }] : []),
              ],
            },
            select: { id: true, fullName: true, email: true, role: { select: { name: true } } },
            orderBy: { id: 'asc' },
            take: LIMIT,
          })
        : [],
      can.users
        ? this.prisma.barbershop.findMany({
            where: {
              OR: [{ name: contains }, { slug: contains }, ...(safeId ? [{ id: safeId }] : [])],
            },
            select: { id: true, name: true, city: true, state: true },
            orderBy: { id: 'asc' },
            take: LIMIT,
          })
        : [],
      can.clients
        ? this.prisma.clientAccount.findMany({
            where: {
              deletedAt: null,
              OR: [{ email: contains }, { name: contains }, ...(safeId ? [{ id: safeId }] : [])],
            },
            select: { id: true, name: true, email: true },
            orderBy: { id: 'asc' },
            take: LIMIT,
          })
        : [],
    ]);

    return [
      ...users.map((u) => ({
        kind: 'user' as const,
        id: u.id,
        title: u.fullName,
        subtitle: `${u.email} · ${u.role?.name ?? ''}`,
      })),
      ...shops.map((b) => ({
        kind: 'barbershop' as const,
        id: b.id,
        title: b.name,
        subtitle: `${b.city}/${b.state}`,
      })),
      ...clients.map((c) => ({
        kind: 'client' as const,
        id: c.id,
        title: c.name,
        subtitle: c.email,
      })),
    ];
  }
}
