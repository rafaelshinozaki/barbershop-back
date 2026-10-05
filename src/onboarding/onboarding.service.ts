import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildSteps,
  canMark,
  shouldShow,
  type OnboardingRole,
  type OnboardingStep,
} from './onboarding';

type Link = { barbershopId: number; name: string; role: OnboardingRole; since: Date };

export type Onboarding = {
  barbershopId: number | null;
  barbershopName: string | null;
  role: OnboardingRole;
  steps: OnboardingStep[];
};

const STAFF_ROLE: Record<string, OnboardingRole> = {
  manager: 'manager',
  reception: 'reception',
  basic: 'basic',
};

/**
 * Boas-vindas por cargo: os passos de quem acabou de entrar numa unidade,
 * com o que já está feito conferido nos dados. O progresso marcado à mão e o
 * "Dispensar" ficam no banco (valem em qualquer aparelho).
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Unidades da pessoa, com o cargo e desde quando (dono primeiro) */
  private async links(userId: number): Promise<Link[]> {
    const [owned, staff] = await Promise.all([
      this.prisma.barbershop.findMany({
        where: { OR: [{ ownerUserId: userId }, { network: { ownerUserId: userId } }] },
        select: { id: true, name: true, createdAt: true, practiceKind: true },
      }),
      this.prisma.barber.findMany({
        where: { userId, isActive: true },
        select: {
          barbershopId: true,
          staffType: true,
          createdAt: true,
          barbershop: { select: { name: true } },
        },
      }),
    ]);
    const links = new Map<number, Link>();
    for (const s of staff) {
      links.set(s.barbershopId, {
        barbershopId: s.barbershopId,
        name: s.barbershop.name,
        role: STAFF_ROLE[s.staffType ?? ''] ?? 'barber',
        since: s.createdAt,
      });
    }
    for (const b of owned) {
      links.set(b.id, {
        barbershopId: b.id,
        name: b.name,
        role: b.practiceKind === 'solo' ? 'solo' : 'owner',
        since: b.createdAt,
      });
    }
    return [...links.values()].sort((a, b) => b.since.getTime() - a.since.getTime());
  }

  /** O que o sistema confere sozinho, por cargo */
  private async autoDone(link: Link, userId: number, photoKey: string | null) {
    const id = link.barbershopId;
    const count = (n: Promise<number>) => n.then((v) => v > 0);
    switch (link.role) {
      case 'owner': {
        const [services, shop, team, invites, account, appointments] = await Promise.all([
          count(
            this.prisma.barbershopService.count({ where: { barbershopId: id, isActive: true } }),
          ),
          this.prisma.barbershop.findUnique({ where: { id }, select: { businessHours: true } }),
          count(
            this.prisma.barber.count({
              where: { barbershopId: id, isActive: true, NOT: { userId } },
            }),
          ),
          count(this.prisma.employeeInvite.count({ where: { barbershopId: id } })),
          this.prisma.paymentAccount.findUnique({
            where: { ownerType_ownerId: { ownerType: 'barbershop', ownerId: id } },
            select: { chargesEnabled: true },
          }),
          count(this.prisma.appointment.count({ where: { barbershopId: id } })),
        ]);
        return {
          services,
          hours: Boolean(shop?.businessHours),
          team: team || invites,
          payments: Boolean(account?.chargesEnabled),
          firstAppointment: appointments,
        };
      }
      case 'solo': {
        const [services, shop, appointments, calendarSync, profile] = await Promise.all([
          count(
            this.prisma.barbershopService.count({ where: { barbershopId: id, isActive: true } }),
          ),
          this.prisma.barbershop.findUnique({ where: { id }, select: { businessHours: true } }),
          count(this.prisma.appointment.count({ where: { barbershopId: id } })),
          count(this.prisma.calendarFeed.count({ where: { userId, barbershopId: id } })),
          this.professional(userId),
        ]);
        return {
          services,
          hours: Boolean(shop?.businessHours),
          firstAppointment: appointments,
          calendarSync,
          photo: Boolean(photoKey),
          publicProfile: isProfilePublished(profile),
        };
      }
      case 'manager':
      case 'reception':
        return {
          cashier: await count(
            this.prisma.cashSession.count({ where: { barbershopId: id, openedByUserId: userId } }),
          ),
        };
      case 'barber':
      case 'basic': {
        const [schedule, calendarSync] = await Promise.all([
          count(
            this.prisma.barberSchedule.count({
              where: { barber: { userId, barbershopId: id } },
            }),
          ),
          count(this.prisma.calendarFeed.count({ where: { userId, barbershopId: id } })),
        ]);
        return { schedule, calendarSync, photo: Boolean(photoKey) };
      }
      default:
        return {};
    }
  }

  private professional(userId: number) {
    return this.prisma.professional.findUnique({
      where: { userId },
      select: { slug: true, visibility: true, openToWork: true },
    });
  }

  private progress(userId: number, barbershopId: number) {
    return this.prisma.onboardingProgress.findUnique({
      where: { userId_barbershopId: { userId, barbershopId } },
    });
  }

  /**
   * O card da tela inicial: a unidade mais recente da pessoa em que ainda há
   * passo por fazer (ou a pedida). null = nada a mostrar.
   */
  async forUser(
    userId: number,
    barbershopId?: number | null,
    now = new Date(),
  ): Promise<Onboarding | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, photoKey: true, role: { select: { name: true } } },
    });
    if (!user) return null;
    const links = await this.links(userId);

    if (links.length === 0) {
      // Sem unidade: o dono que ainda não cadastrou a dele, ou o profissional
      // (perfil público e vagas). A equipe sem unidade não tem card.
      const role = await this.unitlessRole(userId, user.role?.name);
      if (!role) return null;
      const profile = role === 'professional' ? await this.professional(userId) : null;
      const auto =
        role === 'newOwner'
          ? { createShop: false }
          : {
              photo: Boolean(user.photoKey),
              publicProfile: isProfilePublished(profile),
              openToWork: Boolean(profile?.openToWork),
            };
      const steps = buildSteps(role, auto, []);
      const progress = await this.progress(userId, 0);
      return shouldShow(steps, user.createdAt, progress?.dismissedAt, now)
        ? { barbershopId: null, barbershopName: null, role, steps }
        : null;
    }

    const candidates =
      barbershopId != null ? links.filter((l) => l.barbershopId === barbershopId) : links;
    for (const link of candidates) {
      const [auto, progress] = await Promise.all([
        this.autoDone(link, userId, user.photoKey),
        this.progress(userId, link.barbershopId),
      ]);
      const steps = buildSteps(link.role, auto, progress?.stepsDone ?? []);
      if (shouldShow(steps, link.since, progress?.dismissedAt, now)) {
        return {
          barbershopId: link.barbershopId,
          barbershopName: link.name,
          role: link.role,
          steps,
        };
      }
    }
    return null;
  }

  /** Sem unidade: dono a cadastrar (newOwner), profissional, ou nenhum card */
  private async unitlessRole(
    userId: number,
    roleName: string | null | undefined,
  ): Promise<OnboardingRole | null> {
    if (roleName === 'BarbershopOwner') return 'newOwner';
    return (await this.professional(userId)) ? 'professional' : null;
  }

  private async roleIn(userId: number, barbershopId: number | null) {
    const links = await this.links(userId);
    if (barbershopId == null) {
      if (links.length > 0) return null;
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: { select: { name: true } } },
      });
      return this.unitlessRole(userId, user?.role?.name);
    }
    return links.find((l) => l.barbershopId === barbershopId)?.role ?? null;
  }

  /** Passo que a pessoa marca ao abrir (os automáticos não) */
  async markStep(userId: number, barbershopId: number | null, step: string) {
    const role = await this.roleIn(userId, barbershopId);
    if (!role || !canMark(role, step)) {
      throw new BadRequestException('Passo inválido para o seu cargo nesta unidade');
    }
    const key = barbershopId ?? 0;
    const current = await this.progress(userId, key);
    const stepsDone = [...new Set([...(current?.stepsDone ?? []), step])];
    await this.prisma.onboardingProgress.upsert({
      where: { userId_barbershopId: { userId, barbershopId: key } },
      create: { userId, barbershopId: key, stepsDone },
      update: { stepsDone },
    });
    return true;
  }

  /** "Dispensar": some em todos os aparelhos */
  async dismiss(userId: number, barbershopId: number | null) {
    const role = await this.roleIn(userId, barbershopId);
    if (!role) throw new BadRequestException('Unidade inválida');
    const key = barbershopId ?? 0;
    await this.prisma.onboardingProgress.upsert({
      where: { userId_barbershopId: { userId, barbershopId: key } },
      create: { userId, barbershopId: key, dismissedAt: new Date() },
      update: { dismissedAt: new Date() },
    });
    return true;
  }

  /**
   * Boas-vindas do cliente final (área do cliente): tudo conferido nos dados
   * (e-mail confirmado, telefone, um favorito, notificação no celular). Some
   * depois de 30 dias da conta, com tudo feito ou ao dispensar.
   */
  async forClient(clientAccountId: number, now = new Date()): Promise<Onboarding | null> {
    const account = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      select: {
        createdAt: true,
        emailVerifiedAt: true,
        phone: true,
        onboardingDismissedAt: true,
        deletedAt: true,
      },
    });
    if (!account || account.deletedAt) return null;
    const [favorites, favoriteBarbers, push] = await Promise.all([
      this.prisma.clientFavorite.count({ where: { clientAccountId } }),
      this.prisma.clientFavoriteBarber.count({ where: { clientAccountId } }),
      this.prisma.pushSubscription.count({ where: { clientAccountId } }),
    ]);
    const steps = buildSteps(
      'client',
      {
        verifyEmail: Boolean(account.emailVerifiedAt),
        phone: Boolean(account.phone?.trim()),
        favorite: favorites + favoriteBarbers > 0,
        push: push > 0,
      },
      [],
    );
    return shouldShow(steps, account.createdAt, account.onboardingDismissedAt, now)
      ? { barbershopId: null, barbershopName: null, role: 'client', steps }
      : null;
  }

  async dismissClient(clientAccountId: number) {
    await this.prisma.clientAccount.update({
      where: { id: clientAccountId },
      data: { onboardingDismissedAt: new Date() },
    });
    return true;
  }
}

/** Perfil público no ar: com endereço (/p/:slug) e visível na plataforma ou na web */
function isProfilePublished(
  profile: { slug: string | null; visibility: string } | null | undefined,
): boolean {
  return Boolean(profile?.slug) && profile?.visibility !== 'hidden';
}
