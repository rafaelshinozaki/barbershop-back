import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { safeTimeZone, toZonedParts } from '../common/timezone.util';
import {
  buildCareerOverview,
  CareerPlaceInput,
  pickCommissionPercent,
  slugifyName,
  visiblePastVisit,
} from './career';
import { ensureProfessional } from './professional';

function amount(value: { toString(): string } | number | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

/**
 * O que a pessoa fez em todas as unidades em que o vínculo ainda aponta pra ela.
 * Um reingresso na mesma unidade desliga o vínculo antigo (pra liberar a vaga
 * e a agenda); esse período deixa de aparecer aqui.
 */
@Injectable()
export class CareerService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: number) {
    const barbers = await this.prisma.barber.findMany({
      where: { OR: [{ userId }, { professional: { is: { userId } } }] },
      select: {
        id: true,
        staffType: true,
        isActive: true,
        hireDate: true,
        createdAt: true,
        updatedAt: true,
        accessEndsAt: true,
        barbershopId: true,
        barbershop: { select: { id: true, name: true, timezone: true, currency: true } },
      },
    });
    const ids = [...new Set(barbers.map((barber) => barber.id))];
    const shopIds = [...new Set(barbers.map((barber) => barber.barbershopId))];
    const overview =
      ids.length === 0
        ? buildCareerOverview({ places: [], visits: [], payouts: [] })
        : await this.totals(barbers, ids, shopIds);

    const formerIds = barbers.filter((barber) => !barber.isActive).map((barber) => barber.id);
    const shopName = new Map(barbers.map((barber) => [barber.id, barber.barbershop.name]));
    const [professional, ownedShops, pastAppointments] = await Promise.all([
      this.prisma.professional.findUnique({
        where: { userId },
        select: { slug: true, isPublic: true },
      }),
      this.prisma.barbershop.findMany({
        where: { ownerUserId: userId, isActive: true },
        select: { name: true, slug: true },
        orderBy: { name: 'asc' },
      }),
      formerIds.length === 0
        ? Promise.resolve([])
        : this.prisma.appointment.findMany({
            where: { barberId: { in: formerIds }, status: 'COMPLETED' },
            orderBy: { startAt: 'desc' },
            take: 50,
            select: { startAt: true, barberId: true, customer: { select: { name: true } } },
          }),
    ]);

    return {
      ...overview,
      pastVisits: pastAppointments.map((appointment) =>
        visiblePastVisit({
          shopName: shopName.get(appointment.barberId) ?? '',
          occurredAt: appointment.startAt,
          customerName: appointment.customer.name,
        }),
      ),
      ownedShops,
      slug: professional?.slug ?? null,
      isPublic: professional?.isPublic ?? false,
    };
  }

  /** Liga ou esconde /p/:slug. O endereço nasce na primeira vez que fica público. */
  async setPublic(userId: number, isPublic: boolean) {
    const [user, professional] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
      ensureProfessional(this.prisma, userId),
    ]);
    if (isPublic && !professional.slug) {
      await this.assignSlug(professional.id, user?.fullName ?? '');
    }
    await this.prisma.professional.update({
      where: { id: professional.id },
      data: { isPublic },
    });
    return this.overview(userId);
  }

  /** Página pública: profissional, com elo para o estabelecimento de que é dono. */
  async publicProfile(slug: string) {
    const professional = await this.prisma.professional.findUnique({
      where: { slug },
      select: {
        isPublic: true,
        userId: true,
        user: { select: { fullName: true } },
        barbers: {
          where: { isActive: true },
          select: { barbershop: { select: { name: true, slug: true, isActive: true } } },
        },
      },
    });
    if (!professional?.isPublic) throw new NotFoundException('Perfil não encontrado');
    const [owns, completedAppointments] = await Promise.all([
      this.prisma.barbershop.findMany({
        where: { ownerUserId: professional.userId, isActive: true },
        select: { name: true, slug: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.appointment.count({
        where: {
          status: 'COMPLETED',
          barber: { professional: { userId: professional.userId } },
        },
      }),
    ]);
    const seen = new Set<string>();
    const worksAt: { name: string; slug: string }[] = [];
    for (const barber of professional.barbers) {
      const shop = barber.barbershop;
      if (!shop.isActive || seen.has(shop.slug)) continue;
      seen.add(shop.slug);
      worksAt.push({ name: shop.name, slug: shop.slug });
    }
    return {
      fullName: professional.user.fullName,
      completedAppointments,
      worksAt,
      owns,
    };
  }

  private async assignSlug(professionalId: number, fullName: string) {
    const base = slugifyName(fullName);
    for (let n = 0; n < 50; n++) {
      const slug = n === 0 ? base : `${base}-${n + 1}`;
      try {
        await this.prisma.professional.update({ where: { id: professionalId }, data: { slug } });
        return;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
      }
    }
    await this.prisma.professional.update({
      where: { id: professionalId },
      data: { slug: `${base}-${professionalId}` },
    });
  }

  private async totals(
    barbers: {
      id: number;
      staffType: string | null;
      isActive: boolean;
      hireDate: Date | null;
      createdAt: Date;
      updatedAt: Date;
      accessEndsAt: Date | null;
      barbershopId: number;
      barbershop: { id: number; name: string; timezone: string; currency: string };
    }[],
    ids: number[],
    shopIds: number[],
  ) {
    const [rules, appointments, payouts] = await Promise.all([
      this.prisma.commissionRule.findMany({
        where: {
          OR: [{ barberId: { in: ids } }, { barberId: null, barbershopId: { in: shopIds } }],
        },
        select: { barberId: true, barbershopId: true, itemType: true, percentage: true },
      }),
      this.prisma.appointment.findMany({
        where: { barberId: { in: ids }, status: { in: ['COMPLETED', 'NO_SHOW'] } },
        select: {
          customerId: true,
          status: true,
          startAt: true,
          barberId: true,
          services: {
            select: {
              quantity: true,
              unitPrice: true,
              service: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.barberPayout.findMany({
        where: { barberId: { in: ids } },
        select: { currency: true, total: true, commission: true, tips: true },
      }),
    ]);

    const ruleRows = rules.map((rule) => ({
      barberId: rule.barberId,
      barbershopId: rule.barbershopId,
      itemType: rule.itemType,
      percentage: amount(rule.percentage),
    }));
    const shopOf = new Map(barbers.map((barber) => [barber.id, barber.barbershop]));
    const places: CareerPlaceInput[] = barbers.map((barber) => ({
      barberId: barber.id,
      shopId: barber.barbershop.id,
      shopName: barber.barbershop.name,
      staffType: barber.staffType,
      active: barber.isActive,
      startedAt: barber.hireDate ?? barber.createdAt,
      endedAt: barber.isActive ? null : barber.accessEndsAt ?? barber.updatedAt,
      commissionPercent: pickCommissionPercent(ruleRows, barber.id, barber.barbershopId),
    }));

    return buildCareerOverview({
      places,
      visits: appointments.map((appointment) => {
        const shop = shopOf.get(appointment.barberId);
        const zone = safeTimeZone(shop?.timezone);
        return {
          customerId: appointment.customerId,
          status: appointment.status,
          hour: Math.floor(toZonedParts(appointment.startAt, zone).minutesOfDay / 60),
          currency: shop?.currency ?? 'BRL',
          services: appointment.services.map((line) => ({
            name: line.service.name,
            quantity: line.quantity,
            unitPrice: amount(line.unitPrice),
          })),
        };
      }),
      payouts: payouts.map((payout) => ({
        currency: payout.currency,
        total: amount(payout.total),
        commission: amount(payout.commission),
        tips: amount(payout.tips),
      })),
    });
  }
}
