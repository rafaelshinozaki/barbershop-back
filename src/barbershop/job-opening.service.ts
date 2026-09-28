import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TreatmentCategory } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { PushService } from '@/push/push.service';
import { NotificationType } from '@/notifications/dto/create-notification.dto';
import {
  addDaysStr,
  nextDateStr,
  safeTimeZone,
  toZonedParts,
  zonedTimeToUtc,
} from '@/common/timezone.util';
import { BarbershopService } from './barbershop.service';
import { EmployeeInviteService } from './employee-invite.service';

/** Até quantos dias à frente a vaga pode começar */
const MAX_DAYS_AHEAD = 180;
/** Duração máxima do vínculo de uma vaga (freelancer, não contratação fixa) */
const MAX_LENGTH_DAYS = 90;
/** Vagas abertas ao mesmo tempo por unidade */
const MAX_OPEN_PER_SHOP = 10;
/** Candidaturas aguardando resposta por pessoa */
const MAX_PENDING_PER_USER = 20;

export type JobOpeningInput = {
  barbershopId: number;
  title: string;
  description?: string | null;
  category?: TreatmentCategory | null;
  startDate: string;
  endDate: string;
  payInfo?: string | null;
  slots?: number | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Vagas para freelancer (H5): a unidade abre uma vaga por um período, os
 * profissionais da plataforma se candidatam e a unidade aceita ou recusa.
 * Aceitar cria o convite com vínculo temporário (EmployeeInviteService), e o
 * profissional entra na equipe pelo aceite de convite de sempre.
 */
@Injectable()
export class JobOpeningService {
  private readonly logger = new Logger(JobOpeningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershops: BarbershopService,
    private readonly invites: EmployeeInviteService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  private async today(barbershopId: number) {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { timezone: true },
    });
    const timeZone = safeTimeZone(shop?.timezone);
    return { today: toZonedParts(new Date(), timeZone).dateStr, timeZone };
  }

  private clean(input: JobOpeningInput, today: string) {
    const title = input.title?.trim() ?? '';
    if (title.length < 3 || title.length > 80) {
      throw new BadRequestException('O título vai de 3 a 80 caracteres');
    }
    const description = input.description?.trim() || null;
    if (description && description.length > 1000) {
      throw new BadRequestException('A descrição vai até 1000 caracteres');
    }
    const payInfo = input.payInfo?.trim() || null;
    if (payInfo && payInfo.length > 120) {
      throw new BadRequestException('O pagamento vai até 120 caracteres');
    }
    const { startDate, endDate } = input;
    if (!DATE.test(startDate ?? '') || !DATE.test(endDate ?? '')) {
      throw new BadRequestException('Datas inválidas');
    }
    if (startDate < today || startDate > addDaysStr(today, MAX_DAYS_AHEAD)) {
      throw new BadRequestException(
        `A vaga começa entre hoje e os próximos ${MAX_DAYS_AHEAD} dias`,
      );
    }
    if (endDate < startDate || endDate > addDaysStr(startDate, MAX_LENGTH_DAYS - 1)) {
      throw new BadRequestException(`A vaga dura de 1 a ${MAX_LENGTH_DAYS} dias`);
    }
    const slots = input.slots ?? 1;
    if (!Number.isInteger(slots) || slots < 1 || slots > 10) {
      throw new BadRequestException('De 1 a 10 pessoas por vaga');
    }
    if (input.category != null && !Object.values(TreatmentCategory).includes(input.category)) {
      throw new BadRequestException('Especialidade inválida');
    }
    return {
      title,
      description,
      payInfo,
      startDate,
      endDate,
      slots,
      category: input.category ?? null,
    };
  }

  // ============ UNIDADE (gerente e dono) ============

  async create(userId: number, input: JobOpeningInput) {
    await this.barbershops.ensureAccess(userId, input.barbershopId, 'manager');
    const { today } = await this.today(input.barbershopId);
    const data = this.clean(input, today);
    const open = await this.prisma.jobOpening.count({
      where: { barbershopId: input.barbershopId, status: 'open' },
    });
    if (open >= MAX_OPEN_PER_SHOP) {
      throw new BadRequestException(
        `A unidade já tem ${MAX_OPEN_PER_SHOP} vagas abertas. Encerre alguma antes.`,
      );
    }
    const opening = await this.prisma.jobOpening.create({
      data: { ...data, barbershopId: input.barbershopId, createdByUserId: userId },
    });
    return this.forShop(userId, input.barbershopId, opening.id);
  }

  /** Vagas da unidade com as candidaturas */
  async shopOpenings(userId: number, barbershopId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    const openings = await this.prisma.jobOpening.findMany({
      where: { barbershopId },
      include: this.shopInclude,
      orderBy: [{ status: 'desc' }, { startDate: 'asc' }],
      take: 100,
    });
    return openings.map((o) => this.mapForShop(o));
  }

  private readonly shopInclude = {
    barbershop: { select: { name: true, slug: true, city: true, state: true } },
    applications: {
      orderBy: { createdAt: 'asc' as const },
      include: {
        user: {
          select: {
            fullName: true,
            identityVerifiedAt: true,
            professional: { select: { slug: true, visibility: true, cities: true } },
          },
        },
      },
    },
  };

  private async forShop(userId: number, barbershopId: number, id: number) {
    const opening = await this.prisma.jobOpening.findFirst({
      where: { id, barbershopId },
      include: this.shopInclude,
    });
    if (!opening) throw new NotFoundException('Vaga não encontrada');
    return this.mapForShop(opening);
  }

  private mapForShop(o: any) {
    return {
      ...this.mapOpening(o),
      applications: o.applications.map((a: any) => ({
        id: a.id,
        status: a.status,
        message: a.message,
        createdAt: a.createdAt.toISOString(),
        name: a.user.fullName,
        identityVerified: !!a.user.identityVerifiedAt,
        // Página do profissional só se ele a deixa visível
        professionalSlug:
          a.user.professional?.visibility && a.user.professional.visibility !== 'hidden'
            ? a.user.professional.slug
            : null,
        cities: a.user.professional?.cities ?? [],
      })),
    };
  }

  private mapOpening(o: any) {
    return {
      id: o.id,
      barbershopId: o.barbershopId,
      barbershopName: o.barbershop.name,
      barbershopSlug: o.barbershop.slug,
      city: o.barbershop.city,
      state: o.barbershop.state,
      title: o.title,
      description: o.description,
      category: o.category,
      startDate: o.startDate,
      endDate: o.endDate,
      payInfo: o.payInfo,
      slots: o.slots,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
    };
  }

  /** Encerra a vaga; quem ainda esperava resposta é avisado */
  async close(userId: number, barbershopId: number, id: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    const opening = await this.prisma.jobOpening.findFirst({
      where: { id, barbershopId },
      include: {
        applications: { where: { status: 'pending' }, select: { id: true, userId: true } },
      },
    });
    if (!opening) throw new NotFoundException('Vaga não encontrada');
    if (opening.status !== 'closed') {
      await this.prisma.$transaction([
        this.prisma.jobOpening.update({
          where: { id },
          data: { status: 'closed', closedAt: new Date() },
        }),
        this.prisma.jobApplication.updateMany({
          where: { jobOpeningId: id, status: 'pending' },
          data: { status: 'rejected', decidedAt: new Date() },
        }),
      ]);
      await this.notify(
        opening.applications.map((a) => a.userId),
        'Vaga encerrada',
        `A vaga "${opening.title}" foi encerrada pela unidade.`,
        '/jobs',
      );
    }
    return this.forShop(userId, barbershopId, id);
  }

  /** Aceita: cria o convite com o período da vaga; o profissional aceita pelo e-mail */
  async accept(userId: number, barbershopId: number, applicationId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    const application = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, jobOpening: { barbershopId } },
      include: {
        jobOpening: true,
        user: { select: { id: true, email: true, fullName: true, phone: true } },
      },
    });
    if (!application) throw new NotFoundException('Candidatura não encontrada');
    if (application.status !== 'pending') {
      throw new BadRequestException('Esta candidatura já foi respondida');
    }
    const opening = application.jobOpening;
    if (opening.status !== 'open') throw new BadRequestException('A vaga não está mais aberta');

    const { timeZone } = await this.today(barbershopId);
    // Do começo do primeiro dia ao fim do último, no fuso da unidade
    const accessStartsAt = zonedTimeToUtc(opening.startDate, 0, timeZone);
    const accessEndsAt = new Date(
      zonedTimeToUtc(nextDateStr(opening.endDate), 0, timeZone).getTime() - 1,
    );
    // Condicional: dois gerentes aceitando ao mesmo tempo não criam dois convites
    const claimed = await this.prisma.jobApplication.updateMany({
      where: { id: applicationId, status: 'pending' },
      data: { status: 'accepted', decidedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('Esta candidatura já foi respondida');
    let inviteId: number;
    try {
      const { invite } = await this.invites.createInvite(userId, {
        barbershopId,
        email: application.user.email,
        name: application.user.fullName,
        phone: application.user.phone,
        role: 'BarbershopEmployee',
        staffType: 'barber',
        accessStartsAt: accessStartsAt.toISOString(),
        accessEndsAt: accessEndsAt.toISOString(),
      });
      inviteId = invite.id;
    } catch (err) {
      await this.prisma.jobApplication.update({
        where: { id: applicationId },
        data: { status: 'pending', decidedAt: null },
      });
      throw err;
    }
    await this.prisma.jobApplication.update({ where: { id: applicationId }, data: { inviteId } });
    const accepted = await this.prisma.jobApplication.count({
      where: { jobOpeningId: opening.id, status: 'accepted' },
    });
    if (accepted >= opening.slots) {
      await this.prisma.jobOpening.update({
        where: { id: opening.id },
        data: { status: 'filled' },
      });
    }
    await this.notify(
      [application.userId],
      'Candidatura aceita',
      `Você foi aceito na vaga "${opening.title}". Aceite o convite que chegou no seu e-mail para entrar na equipe.`,
      '/jobs',
    );
    return this.forShop(userId, barbershopId, opening.id);
  }

  async reject(userId: number, barbershopId: number, applicationId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    const application = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, jobOpening: { barbershopId } },
      include: { jobOpening: { select: { id: true, title: true } } },
    });
    if (!application) throw new NotFoundException('Candidatura não encontrada');
    const done = await this.prisma.jobApplication.updateMany({
      where: { id: applicationId, status: 'pending' },
      data: { status: 'rejected', decidedAt: new Date() },
    });
    if (done.count === 0) throw new BadRequestException('Esta candidatura já foi respondida');
    await this.notify(
      [application.userId],
      'Candidatura não aceita',
      `A unidade não seguiu com a sua candidatura para "${application.jobOpening.title}".`,
      '/jobs',
    );
    return this.forShop(userId, barbershopId, application.jobOpening.id);
  }

  // ============ PROFISSIONAL ============

  /** Vagas abertas (que ainda não acabaram), com a situação da minha candidatura */
  async openOpenings(
    userId: number,
    filters: { city?: string | null; category?: TreatmentCategory | null } = {},
  ) {
    const today = toZonedParts(new Date(), 'America/Sao_Paulo').dateStr;
    const city = filters.city?.trim();
    const openings = await this.prisma.jobOpening.findMany({
      where: {
        status: 'open',
        endDate: { gte: addDaysStr(today, -1) },
        barbershop: {
          isActive: true,
          ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
        },
        ...(filters.category ? { OR: [{ category: filters.category }, { category: null }] } : {}),
      },
      include: {
        barbershop: { select: { name: true, slug: true, city: true, state: true } },
        applications: { where: { userId }, select: { id: true, status: true } },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    const myShops = new Set(await this.myShopIds(userId));
    return openings
      .filter((o) => !myShops.has(o.barbershopId))
      .map((o) => ({
        ...this.mapOpening(o),
        myApplicationId: o.applications[0]?.id ?? null,
        myApplicationStatus: o.applications[0]?.status ?? null,
      }));
  }

  /** Unidades em que a pessoa já está (dona ou na equipe): não se candidata nelas */
  private async myShopIds(userId: number) {
    const [owned, team] = await Promise.all([
      this.prisma.barbershop.findMany({
        where: { OR: [{ ownerUserId: userId }, { network: { ownerUserId: userId } }] },
        select: { id: true },
      }),
      this.prisma.barber.findMany({
        where: { userId, isActive: true },
        select: { barbershopId: true },
      }),
    ]);
    return [...owned.map((b) => b.id), ...team.map((b) => b.barbershopId)];
  }

  async apply(userId: number, openingId: number, message?: string | null) {
    const opening = await this.prisma.jobOpening.findUnique({
      where: { id: openingId },
      include: { barbershop: { select: { isActive: true } } },
    });
    if (!opening || !opening.barbershop.isActive)
      throw new NotFoundException('Vaga não encontrada');
    if (opening.status !== 'open') throw new BadRequestException('A vaga não está mais aberta');
    if ((await this.myShopIds(userId)).includes(opening.barbershopId)) {
      throw new ForbiddenException('Você já faz parte desta unidade');
    }
    const text = message?.trim() || null;
    if (text && text.length > 500)
      throw new BadRequestException('A mensagem vai até 500 caracteres');
    const pending = await this.prisma.jobApplication.count({
      where: { userId, status: 'pending' },
    });
    if (pending >= MAX_PENDING_PER_USER) {
      throw new BadRequestException(
        `Você já tem ${MAX_PENDING_PER_USER} candidaturas esperando resposta`,
      );
    }
    const existing = await this.prisma.jobApplication.findUnique({
      where: { jobOpeningId_userId: { jobOpeningId: openingId, userId } },
    });
    if (existing && existing.status !== 'withdrawn') {
      throw new BadRequestException('Você já se candidatou a esta vaga');
    }
    const application = existing
      ? await this.prisma.jobApplication.update({
          where: { id: existing.id },
          data: { status: 'pending', message: text, decidedAt: null },
        })
      : await this.prisma.jobApplication.create({
          data: { jobOpeningId: openingId, userId, message: text },
        });

    const managers = await this.shopManagers(opening.barbershopId);
    const who = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    await this.notify(
      managers,
      'Nova candidatura',
      `${who?.fullName ?? 'Um profissional'} se candidatou à vaga "${opening.title}".`,
      `/barbershops/${opening.barbershopId}/jobs`,
    );
    return { id: application.id, status: application.status };
  }

  async withdraw(userId: number, applicationId: number) {
    const done = await this.prisma.jobApplication.updateMany({
      where: { id: applicationId, userId, status: 'pending' },
      data: { status: 'withdrawn', decidedAt: new Date() },
    });
    if (done.count === 0) throw new BadRequestException('Não há candidatura esperando resposta');
    return true;
  }

  async myApplications(userId: number) {
    const rows = await this.prisma.jobApplication.findMany({
      where: { userId },
      include: {
        jobOpening: {
          include: { barbershop: { select: { name: true, slug: true, city: true, state: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((a) => ({
      id: a.id,
      status: a.status,
      message: a.message,
      createdAt: a.createdAt.toISOString(),
      opening: this.mapOpening(a.jobOpening),
    }));
  }

  // ============ AVISOS ============

  /** Dono (da unidade e da rede) e gerentes ativos */
  private async shopManagers(barbershopId: number) {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: {
        ownerUserId: true,
        network: { select: { ownerUserId: true } },
        barbers: {
          where: { isActive: true, staffType: 'manager', userId: { not: null } },
          select: { userId: true },
        },
      },
    });
    const ids = [
      shop?.ownerUserId,
      shop?.network?.ownerUserId,
      ...(shop?.barbers.map((b) => b.userId) ?? []),
    ].filter((id): id is number => typeof id === 'number');
    return [...new Set(ids)];
  }

  private async notify(userIds: number[], title: string, message: string, actionUrl: string) {
    if (!userIds.length) return;
    try {
      await this.prisma.userNotification.createMany({
        data: userIds.map((userId) => ({
          userId,
          title,
          message,
          type: NotificationType.INFO,
          actionUrl,
        })),
      });
      this.realtime.notifyUsers(userIds, 'CREATED', title);
      await this.push.sendToUsers(userIds, () => ({
        title,
        body: message,
        url: actionUrl,
        tag: 'jobs',
      }));
    } catch (err) {
      this.logger.warn(`Aviso de vaga não enviado: ${err}`);
    }
  }
}
