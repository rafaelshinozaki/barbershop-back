import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TreatmentCategory } from '@prisma/client';
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
import { ProfessionalReviewService } from './professional-review.service';
import { professionalBadges } from './badges';
import {
  canViewProfile,
  parseProfessionalSignup,
  parseProfilePatch,
  presentPublicProfile,
  ProfilePrivacyError,
  ProfileVisibility,
} from './profile-privacy';

function emptyChoices() {
  return {
    visibility: 'hidden' as const,
    roles: [] as string[],
    specialties: [] as TreatmentCategory[],
    cities: [] as string[],
    openToWork: false,
    engagements: [] as string[],
    acceptedRoles: [] as string[],
    acceptingClients: true,
    showPhoto: true,
    showRating: true,
    showAppointmentCount: true,
    showReviews: true,
    showWorkHistory: true,
    showLocations: true,
    showContact: false,
    offersHomeService: false,
  };
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ProfessionalReviewService,
  ) {}

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
        select: { id: true, slug: true, visibility: true, isPublic: true },
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

    const rating = professional
      ? await this.reviews.summary(professional.id)
      : { averageRating: null, reviewCount: 0 };
    return {
      ...overview,
      // Os próprios selos, mesmo os de campos que a página pública esconde
      badges: professionalBadges({
        ...rating,
        completed: overview.completedAppointments,
        uniqueClients: overview.uniqueClients,
        returningClients: overview.returningClients,
      }),
      pastVisits: pastAppointments.map((appointment) =>
        visiblePastVisit({
          shopName: shopName.get(appointment.barberId) ?? '',
          occurredAt: appointment.startAt,
          customerName: appointment.customer.name,
        }),
      ),
      ownedShops,
      slug: professional?.slug ?? null,
      isPublic: (professional?.visibility ?? 'hidden') === 'public',
      visibility: professional?.visibility ?? 'hidden',
    };
  }

  /** Atalho antigo: público ou oculto. O controle completo é a página de privacidade. */
  async setPublic(userId: number, isPublic: boolean) {
    await ensureProfessional(this.prisma, userId);
    await this.updatePrivacy(userId, { visibility: isPublic ? 'public' : 'hidden' });
    return this.overview(userId);
  }

  async privacy(userId: number) {
    const [user, professional, shifts] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true, phone: true, email: true, photoKey: true },
      }),
      this.prisma.professional.findUnique({ where: { userId } }),
      this.shifts(userId),
    ]);
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const facts = professional
      ? await this.profileFacts(professional.userId)
      : { completedAppointments: 0, worksAt: [], workedAt: [], owns: [] };
    return {
      hasProfile: Boolean(professional),
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      photoKey: user.photoKey,
      ...facts,
      shifts,
      ...(professional ? this.choicesOf(professional) : emptyChoices()),
    };
  }

  /** Quem entrou como cliente da equipe, ou dono, liga o perfil sem outra conta. */
  async enableProfile(userId: number, input: Parameters<typeof parseProfessionalSignup>[0]) {
    await this.applySignup(userId, input);
    return this.privacy(userId);
  }

  async applySignup(userId: number, input: Parameters<typeof parseProfessionalSignup>[0]) {
    const choices = this.parse(input, parseProfessionalSignup);
    const professional = await ensureProfessional(this.prisma, userId);
    await this.prisma.professional.update({
      where: { id: professional.id },
      data: choices,
    });
  }

  async updatePrivacy(userId: number, input: Parameters<typeof parseProfilePatch>[0]) {
    const patch = this.parse(input, parseProfilePatch);
    const [user, professional] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
      this.prisma.professional.findUnique({ where: { userId } }),
    ]);
    if (!professional) throw new NotFoundException('Ative o perfil de profissional antes');
    const visibility = patch.visibility ?? (professional.visibility as ProfileVisibility);
    if (visibility !== 'hidden' && !professional.slug) {
      await this.assignSlug(professional.id, user?.fullName ?? '');
    }
    await this.prisma.professional.update({
      where: { id: professional.id },
      data: {
        ...patch,
        ...(patch.visibility ? { isPublic: patch.visibility === 'public' } : {}),
      },
    });
    return this.privacy(userId);
  }

  /** Página /p/:slug. Oculto responde como se não existisse. */
  async publicProfile(slug: string, viewerUserId?: number | null) {
    const professional = await this.prisma.professional.findUnique({ where: { slug } });
    const visibility = (professional?.visibility ?? 'hidden') as ProfileVisibility;
    // Suspenso pela moderação: fica fora do ar como se não existisse
    if (!professional || professional.suspendedAt || !canViewProfile(visibility, viewerUserId)) {
      throw new NotFoundException('Perfil não encontrado');
    }
    const [user, facts, rating, reviews, clients] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: professional.userId },
        select: {
          fullName: true,
          phone: true,
          email: true,
          photoKey: true,
          identityVerifiedAt: true,
          isActive: true,
        },
      }),
      this.profileFacts(professional.userId),
      this.reviews.summary(professional.id),
      professional.showReviews
        ? this.reviews.publicReviews(professional.id)
        : ([] as Awaited<ReturnType<ProfessionalReviewService['publicReviews']>>),
      this.clientCounts(professional.userId),
    ]);
    // Conta desativada pela plataforma: igual a perfil suspenso
    if (!user || !user.isActive) throw new NotFoundException('Perfil não encontrado');
    return {
      id: professional.id,
      // Atende a domicílio só aparece com a identidade verificada
      homeService: professional.offersHomeService && !!user.identityVerifiedAt,
      identityVerified: !!user.identityVerifiedAt,
      ...presentPublicProfile({
        fullName: user.fullName,
        photoKey: user.photoKey,
        phone: user.phone,
        email: user.email,
        ...facts,
        rating: professional.showRating ? rating : undefined,
        reviews,
        badges: professionalBadges({
          ...rating,
          completed: facts.completedAppointments,
          ...clients,
        }),
        choices: this.choicesOf(professional),
      }),
    };
  }

  private choicesOf(professional: {
    visibility: string;
    roles: string[];
    specialties: TreatmentCategory[];
    cities: string[];
    openToWork: boolean;
    engagements: string[];
    acceptedRoles: string[];
    acceptingClients: boolean;
    showPhoto: boolean;
    showRating: boolean;
    showAppointmentCount: boolean;
    showReviews: boolean;
    showWorkHistory: boolean;
    showLocations: boolean;
    showContact: boolean;
    offersHomeService: boolean;
  }) {
    return {
      visibility: professional.visibility as ProfileVisibility,
      roles: professional.roles,
      specialties: professional.specialties,
      cities: professional.cities,
      openToWork: professional.openToWork,
      engagements: professional.engagements,
      acceptedRoles: professional.acceptedRoles,
      acceptingClients: professional.acceptingClients,
      showPhoto: professional.showPhoto,
      showRating: professional.showRating,
      showAppointmentCount: professional.showAppointmentCount,
      showReviews: professional.showReviews,
      showWorkHistory: professional.showWorkHistory,
      showLocations: professional.showLocations,
      showContact: professional.showContact,
      offersHomeService: professional.offersHomeService,
    };
  }

  /** Clientes diferentes e os que voltaram (mais de um atendimento concluído) */
  private async clientCounts(userId: number) {
    const rows = await this.prisma.appointment.groupBy({
      by: ['customerId'],
      where: { status: 'COMPLETED', barber: { professional: { is: { userId } } } },
      _count: { _all: true },
    });
    return {
      uniqueClients: rows.length,
      returningClients: rows.filter((row) => row._count._all > 1).length,
    };
  }

  /**
   * Histórico de atendimentos do profissional, em todas as unidades: quando,
   * onde, o primeiro nome do cliente, os serviços, a nota que recebeu e a
   * caixinha que foi pra ele.
   */
  async serviceHistory(userId: number) {
    const rows = await this.prisma.appointment.findMany({
      where: {
        status: 'COMPLETED',
        barber: { OR: [{ userId }, { professional: { is: { userId } } }] },
      },
      orderBy: { startAt: 'desc' },
      take: 100,
      select: {
        id: true,
        startAt: true,
        customer: { select: { name: true } },
        barbershop: { select: { name: true, currency: true } },
        services: { select: { service: { select: { name: true } } } },
        professionalReview: { select: { rating: true, hiddenAt: true } },
        tips: { where: { destination: 'professional' }, select: { amount: true } },
      },
    });
    return rows.map((a) => ({
      appointmentId: a.id,
      startAt: a.startAt,
      shopName: a.barbershop.name,
      currency: a.barbershop.currency,
      customerFirstName: a.customer.name.trim().split(/\s+/)[0] || 'Cliente',
      serviceNames: a.services
        .map((s) => s.service?.name)
        .filter(Boolean)
        .join(', '),
      rating:
        a.professionalReview && !a.professionalReview.hiddenAt ? a.professionalReview.rating : null,
      tip: a.tips.length ? a.tips.reduce((sum, t) => sum + Number(t.amount), 0) : null,
    }));
  }

  private async profileFacts(userId: number) {
    const [barbers, owns, completedAppointments] = await Promise.all([
      this.prisma.barber.findMany({
        where: { professional: { userId } },
        select: {
          isActive: true,
          barbershop: { select: { name: true, slug: true, isActive: true } },
        },
      }),
      this.prisma.barbershop.findMany({
        where: { ownerUserId: userId, isActive: true },
        select: { name: true, slug: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.appointment.count({
        where: { status: 'COMPLETED', barber: { professional: { userId } } },
      }),
    ]);
    const worksAt: { name: string; slug: string }[] = [];
    const seen = new Set<string>();
    for (const barber of barbers) {
      const shop = barber.barbershop;
      if (!barber.isActive || !shop.isActive || seen.has(shop.slug)) continue;
      seen.add(shop.slug);
      worksAt.push({ name: shop.name, slug: shop.slug });
    }
    const workedAt: { name: string; slug: string }[] = [];
    const seenFormer = new Set<string>();
    for (const barber of barbers) {
      const shop = barber.barbershop;
      if (barber.isActive || !shop.isActive || seen.has(shop.slug) || seenFormer.has(shop.slug))
        continue;
      seenFormer.add(shop.slug);
      workedAt.push({ name: shop.name, slug: shop.slug });
    }
    return { completedAppointments, worksAt, workedAt, owns };
  }

  private async shifts(userId: number) {
    const rows = await this.prisma.barberSchedule.findMany({
      where: { isActive: true, barber: { isActive: true, professional: { userId } } },
      select: {
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        barber: { select: { barbershop: { select: { name: true } } } },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      shopName: row.barber.barbershop.name,
    }));
  }

  private parse<T>(input: unknown, fn: (value: any) => T): T {
    try {
      return fn(input);
    } catch (error) {
      if (error instanceof ProfilePrivacyError) throw new BadRequestException(error.message);
      throw error;
    }
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
