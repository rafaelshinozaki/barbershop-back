import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toChangeFields } from '../barbershop/change-log';

const DAY = 86_400_000;

/**
 * Ficha da unidade no backoffice (só leitura): uma unidade inteira num
 * lugar pra equipe da plataforma ajudar sem entrar "como" o negócio. Dono,
 * equipe, plano, recebimento pelo app, Destaque, movimento dos últimos 30
 * dias, pedidos de suporte e denúncias abertos, e o histórico de alterações
 * (aqui com o nome de quem da equipe da plataforma mexeu: é o registro
 * interno). Sem cliente por nome, ficha de saúde nem conversa.
 */
@Injectable()
export class BarbershopDossierService {
  constructor(private readonly prisma: PrismaService) {}

  async detail(barbershopId: number, now = new Date()) {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: {
        id: true,
        name: true,
        slug: true,
        businessType: true,
        practiceKind: true,
        city: true,
        state: true,
        isActive: true,
        createdAt: true,
        featuredUntil: true,
        searchHiddenAt: true,
        onlineDeposit: true,
        networkId: true,
        ownerUserId: true,
        network: { select: { id: true, name: true } },
        barbers: {
          select: { id: true, name: true, staffType: true, isActive: true, userId: true },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!shop) throw new NotFoundException('Unidade não encontrada');
    const since = new Date(now.getTime() - 30 * DAY);

    const [owner, services, customers, appointments, reviews, payment, photoIds] =
      await Promise.all([
        shop.ownerUserId
          ? this.prisma.user.findFirst({
              where: { id: shop.ownerUserId },
              select: {
                id: true,
                fullName: true,
                email: true,
                membership: true,
                proUntil: true,
                isActive: true,
              },
            })
          : null,
        this.prisma.barbershopService.count({ where: { barbershopId, isActive: true } }),
        this.prisma.customer.count({ where: { networkId: shop.networkId } }),
        this.prisma.appointment.groupBy({
          by: ['status'],
          where: { barbershopId, startAt: { gte: since, lt: now } },
          _count: { _all: true },
        }),
        this.prisma.review.aggregate({
          where: { barbershopId, hiddenAt: null },
          _avg: { rating: true },
          _count: { _all: true },
        }),
        this.prisma.paymentAccount.findFirst({
          where: { ownerType: 'barbershop', ownerId: barbershopId },
          select: { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true },
        }),
        this.prisma.barbershopPhoto.findMany({ where: { barbershopId }, select: { id: true } }),
      ]);
    const [openTickets, openReports] = await Promise.all([
      shop.ownerUserId
        ? this.prisma.supportTicket.count({
            where: { userId: shop.ownerUserId, status: { not: 'closed' } },
          })
        : 0,
      photoIds.length
        ? this.prisma.contentReport.count({
            where: {
              targetType: 'photo',
              targetId: { in: photoIds.map((p) => p.id) },
              status: 'open',
            },
          })
        : 0,
    ]);
    const byStatus = new Map(appointments.map((a) => [a.status, a._count._all]));
    const count = (...statuses: string[]) =>
      statuses.reduce((n, s) => n + (byStatus.get(s) ?? 0), 0);

    return {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      businessType: shop.businessType,
      practiceKind: shop.practiceKind,
      city: shop.city,
      state: shop.state,
      isActive: shop.isActive,
      createdAt: shop.createdAt,
      featuredUntil: shop.featuredUntil,
      hiddenFromSearch: shop.searchHiddenAt != null,
      onlineDeposit: shop.onlineDeposit,
      networkName: shop.network?.name ?? null,
      owner,
      team: shop.barbers.map((b) => ({
        id: b.id,
        name: b.name,
        staffType: b.staffType,
        isActive: b.isActive,
        hasAccount: b.userId != null,
      })),
      activeServices: services,
      customers,
      appointments30d: [...byStatus.values()].reduce((a, b) => a + b, 0),
      completed30d: count('COMPLETED'),
      cancelled30d: count('CANCELLED'),
      noShow30d: count('NO_SHOW'),
      reviewAverage: reviews._avg.rating,
      reviewCount: reviews._count._all,
      payments: payment
        ? {
            connected: true,
            chargesEnabled: payment.chargesEnabled,
            payoutsEnabled: payment.payoutsEnabled,
          }
        : { connected: false, chargesEnabled: false, payoutsEnabled: false },
      openSupportTickets: openTickets,
      openReports,
    };
  }

  /**
   * Histórico da unidade e da rede dela, com quem fez pelo nome — inclusive
   * a equipe da plataforma (é o registro interno; o dono vê "Equipe da
   * plataforma").
   */
  async changeLog(barbershopId: number, limit = 30, offset = 0) {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { networkId: true },
    });
    if (!shop) throw new NotFoundException('Unidade não encontrada');
    const where: Prisma.ChangeLogWhereInput = {
      OR: [{ barbershopId }, { barbershopId: null, networkId: shop.networkId }],
    };
    const [total, rows] = await Promise.all([
      this.prisma.changeLog.count({ where }),
      this.prisma.changeLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(Math.max(limit, 1), 100),
        skip: Math.max(offset, 0),
      }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        entityType: r.entityType,
        entityId: r.entityId,
        entityName: r.entityName,
        action: r.action,
        changes: toChangeFields(r.changes),
        actorKind:
          r.actorType === 'staff' || r.origin === 'backoffice'
            ? 'platform'
            : r.actorType === 'user' || r.actorType === 'client'
            ? r.actorType
            : 'system',
        actorId: r.actorId,
        actorName: r.actorName,
        reason: r.reason,
      })),
    };
  }
}
