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
        select: { id: true, name: true, createdAt: true },
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
      links.set(b.id, { barbershopId: b.id, name: b.name, role: 'owner', since: b.createdAt });
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
      // Dono que ainda não cadastrou a unidade; equipe sem unidade não tem card
      if (user.role?.name !== 'BarbershopOwner') return null;
      const steps = buildSteps('newOwner', { createShop: false }, []);
      const progress = await this.progress(userId, 0);
      return shouldShow(steps, user.createdAt, progress?.dismissedAt, now)
        ? { barbershopId: null, barbershopName: null, role: 'newOwner', steps }
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

  private async roleIn(userId: number, barbershopId: number | null) {
    const links = await this.links(userId);
    if (barbershopId == null) return links.length === 0 ? ('newOwner' as const) : null;
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
}
