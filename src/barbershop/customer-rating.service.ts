import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { BarbershopService, type AccessLevel } from './barbershop.service';
import { clientBadges } from './badges';

export type RatingSide = 'unit' | 'professional';

// Dá pra avaliar até 30 dias depois do atendimento
const RATE_WINDOW_MS = 30 * 86_400_000;
// Resumo do dia pro profissional: atendimentos que terminaram entre 2h e 26h atrás
const DIGEST_FROM_MS = 26 * 3_600_000;
const DIGEST_TO_MS = 2 * 3_600_000;
const UNIT_LEVELS: AccessLevel[] = ['reception', 'manager', 'owner'];

function checkScore(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new BadRequestException(`${field}: dê uma nota inteira de 1 a 5.`);
  }
}

const average = (values: number[]) =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

/**
 * Nota do cliente (item 3 do roadmap), como no Uber: a unidade e o
 * profissional que atendeu dão pontualidade e trato de 1 a 5 depois de um
 * atendimento concluído. Sem texto livre sobre a pessoa. A média soma as
 * fichas da mesma conta de cliente (todas as unidades) e só a vê quem atende
 * ou vai atender o cliente, a unidade desse atendimento e o próprio cliente.
 * Nunca é pública. Comparecimento vem do histórico (concluídos x faltas).
 */
@Injectable()
export class CustomerRatingService {
  private readonly logger = new Logger(CustomerRatingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershops: BarbershopService,
    private readonly notificationQueue: NotificationQueueService,
  ) {}

  /** O que a pessoa pode avaliar nesse atendimento e as notas já dadas */
  async forAppointment(userId: number, barbershopId: number, appointmentId: number) {
    const appt = await this.loadAppointment(barbershopId, appointmentId);
    const sides = await this.sidesFor(userId, appt);
    if (!sides.length) throw new ForbiddenException('Você não pode avaliar este cliente');
    const ratings = await this.prisma.customerRating.findMany({
      where: { appointmentId, side: { in: sides } },
      select: { side: true, punctuality: true, treatment: true },
    });
    const open = appt.status === 'COMPLETED' && appt.endAt.getTime() >= Date.now() - RATE_WINDOW_MS;
    return { customerId: appt.customerId, sides: open ? sides : [], ratings };
  }

  async rate(
    userId: number,
    barbershopId: number,
    appointmentId: number,
    side: RatingSide,
    punctuality: number,
    treatment: number,
  ) {
    checkScore(punctuality, 'Pontualidade');
    checkScore(treatment, 'Trato');
    const appt = await this.loadAppointment(barbershopId, appointmentId);
    if (appt.status !== 'COMPLETED') {
      throw new BadRequestException('Só dá pra avaliar o cliente de um atendimento concluído');
    }
    if (appt.endAt.getTime() < Date.now() - RATE_WINDOW_MS) {
      throw new BadRequestException('O prazo pra avaliar esse atendimento (30 dias) já passou');
    }
    if (!(await this.sidesFor(userId, appt)).includes(side)) {
      throw new ForbiddenException('Você não pode avaliar este cliente');
    }
    await this.prisma.customerRating.upsert({
      where: { appointmentId_side: { appointmentId, side } },
      create: {
        appointmentId,
        side,
        barbershopId,
        customerId: appt.customerId,
        raterUserId: userId,
        punctuality,
        treatment,
      },
      update: { punctuality, treatment, raterUserId: userId },
    });
    return true;
  }

  /** Atendimentos recentes do profissional em que ele ainda não avaliou o cliente */
  async pendingForMe(userId: number, now = new Date()) {
    const rows = await this.prisma.appointment.findMany({
      where: {
        status: 'COMPLETED',
        endAt: { gte: new Date(now.getTime() - RATE_WINDOW_MS), lte: now },
        barber: { userId },
        customerRatings: { none: { side: 'professional' } },
      },
      orderBy: { endAt: 'desc' },
      take: 50,
      include: {
        customer: { select: { name: true } },
        barbershop: { select: { id: true, name: true } },
        services: { select: { service: { select: { name: true } } } },
      },
    });
    return rows.map((a) => ({
      appointmentId: a.id,
      barbershopId: a.barbershop.id,
      barbershopName: a.barbershop.name,
      customerName: a.customer.name,
      startAt: a.startAt,
      serviceNames: a.services
        .map((s) => s.service?.name)
        .filter(Boolean)
        .join(', '),
    }));
  }

  /**
   * Média do cliente pra equipe. Recepção pra cima vê qualquer cliente da
   * rede da unidade; barbeiro, só quem já atendeu ou vai atender.
   */
  async conductForStaff(userId: number, barbershopId: number, customerId: number) {
    const level = await this.barbershops.getMyAccessLevel(userId, barbershopId);
    if (!level) throw new ForbiddenException('Você não tem acesso a esta unidade');
    const shop = await this.prisma.barbershop.findUniqueOrThrow({
      where: { id: barbershopId },
      select: { networkId: true },
    });
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: shop.networkId },
      select: { id: true, clientAccountId: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    if (!UNIT_LEVELS.includes(level)) {
      const served = await this.prisma.appointment.findFirst({
        where: {
          customerId,
          barber: { userId },
          status: { notIn: ['CANCELLED', 'DRAFT'] },
        },
        select: { id: true },
      });
      if (!served) throw new ForbiddenException('Só quem atende o cliente vê a nota dele');
    }
    return this.conductOf(customer);
  }

  /**
   * Histórico da unidade: em cada atendimento do cliente, a nota que ele deu
   * ao profissional e a caixinha. Barbeiro vê só os atendimentos dele.
   */
  async visitFeedback(userId: number, barbershopId: number, customerId: number) {
    const level = await this.barbershops.getMyAccessLevel(userId, barbershopId);
    if (!level) throw new ForbiddenException('Você não tem acesso a esta unidade');
    const rows = await this.prisma.appointment.findMany({
      where: {
        barbershopId,
        customerId,
        status: 'COMPLETED',
        ...(UNIT_LEVELS.includes(level) ? {} : { barber: { userId } }),
      },
      select: {
        id: true,
        professionalReview: { select: { rating: true, hiddenAt: true } },
        tips: { select: { amount: true } },
      },
      orderBy: { startAt: 'desc' },
      take: 200,
    });
    return rows.map((a) => ({
      appointmentId: a.id,
      rating:
        a.professionalReview && !a.professionalReview.hiddenAt ? a.professionalReview.rating : null,
      tip: a.tips.length ? a.tips.reduce((sum, t) => sum + Number(t.amount), 0) : null,
    }));
  }

  /** O cliente vê a própria nota e o que a compõe */
  async myConduct(clientAccountId: number) {
    return this.conductOf({ id: null, clientAccountId });
  }

  /**
   * Resumo do dia pro profissional: um e-mail com os atendimentos que ele
   * concluiu e ainda não avaliou o cliente. Uma vez por atendimento.
   */
  async sendDailyDigest(now = new Date()) {
    const due = await this.prisma.appointment.findMany({
      where: {
        status: 'COMPLETED',
        clientRatingRequestSentAt: null,
        endAt: {
          gte: new Date(now.getTime() - DIGEST_FROM_MS),
          lte: new Date(now.getTime() - DIGEST_TO_MS),
        },
        barber: { userId: { not: null } },
        customerRatings: { none: { side: 'professional' } },
      },
      include: {
        customer: { select: { name: true } },
        barbershop: { select: { name: true, timezone: true } },
        barber: { select: { userId: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 1000,
    });
    const byUser = new Map<number, typeof due>();
    for (const appt of due) {
      const claimed = await this.prisma.appointment.updateMany({
        where: { id: appt.id, clientRatingRequestSentAt: null },
        data: { clientRatingRequestSentAt: now },
      });
      if (!claimed.count) continue;
      const userId = appt.barber.userId!;
      byUser.set(userId, [...(byUser.get(userId) ?? []), appt]);
    }
    const front = process.env.FRONTEND_URL || 'http://localhost:5173';
    let sent = 0;
    for (const [userId, appts] of byUser) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, fullName: true },
      });
      if (!user?.email) continue;
      try {
        await this.notificationQueue.email(
          {
            kind: 'user',
            userId,
            template: 'client_rating_request',
            context: {
              FirstName: user.fullName.split(' ')[0],
              Count: appts.length,
              Appointments: appts.map((a) => ({
                Customer: a.customer.name.split(' ')[0],
                Shop: a.barbershop.name,
                Time: a.startAt.toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: a.barbershop.timezone,
                }),
              })),
              RateURL: `${front}/rate-clients`,
              Year: now.getFullYear(),
            },
            subject: {
              pt: `Como foram seus clientes hoje? (${appts.length})`,
              en: `How were your clients today? (${appts.length})`,
              es: `¿Qué tal tus clientes hoy? (${appts.length})`,
            },
            meta: 'client-rating-request',
            to: user.email,
          },
          `client-rating-${userId}-${now.toISOString().slice(0, 10)}`,
        );
        sent++;
      } catch (err) {
        this.logger.error(
          `Erro ao enfileirar resumo de avaliação do cliente (user ${userId}):`,
          err,
        );
        await this.prisma.appointment
          .updateMany({
            where: { id: { in: appts.map((a) => a.id) } },
            data: { clientRatingRequestSentAt: null },
          })
          .catch(() => undefined);
      }
    }
    if (sent) this.logger.log(`Resumos de avaliação do cliente enfileirados: ${sent}`);
    return sent;
  }

  private async loadAppointment(barbershopId: number, appointmentId: number) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      select: {
        id: true,
        status: true,
        endAt: true,
        customerId: true,
        barber: { select: { userId: true } },
        barbershop: { select: { id: true, practiceKind: true } },
      },
    });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    return appt;
  }

  /** O profissional que atendeu avalia pelo lado dele; recepção pra cima, pela unidade (não no solo) */
  private async sidesFor(
    userId: number,
    appt: { barber: { userId: number | null }; barbershop: { id: number; practiceKind: string } },
  ): Promise<RatingSide[]> {
    const sides: RatingSide[] = [];
    if (appt.barber.userId === userId) sides.push('professional');
    if (appt.barbershop.practiceKind !== 'solo') {
      const level = await this.barbershops.getMyAccessLevel(userId, appt.barbershop.id);
      if (level && UNIT_LEVELS.includes(level)) sides.push('unit');
    }
    return sides;
  }

  /** Média das fichas da mesma pessoa (pela conta de cliente) e o comparecimento */
  private async conductOf(customer: { id: number | null; clientAccountId: number | null }) {
    const customerIds = customer.clientAccountId
      ? (
          await this.prisma.customer.findMany({
            where: { clientAccountId: customer.clientAccountId },
            select: { id: true },
          })
        ).map((c) => c.id)
      : customer.id != null
      ? [customer.id]
      : [];
    if (!customerIds.length) {
      return {
        punctuality: null,
        treatment: null,
        ratingCount: 0,
        completed: 0,
        noShows: 0,
        attendanceRate: null,
        badges: [],
      };
    }
    const [ratings, completed, noShows] = await Promise.all([
      this.prisma.customerRating.findMany({
        where: { customerId: { in: customerIds } },
        select: { punctuality: true, treatment: true },
      }),
      this.prisma.appointment.count({
        where: { customerId: { in: customerIds }, status: 'COMPLETED' },
      }),
      this.prisma.appointment.count({
        where: { customerId: { in: customerIds }, status: 'NO_SHOW' },
      }),
    ]);
    const total = completed + noShows;
    const conduct = {
      punctuality: average(ratings.map((r) => r.punctuality)),
      treatment: average(ratings.map((r) => r.treatment)),
      ratingCount: ratings.length,
      completed,
      noShows,
      attendanceRate: total ? Math.round((completed / total) * 100) : null,
    };
    return { ...conduct, badges: clientBadges(conduct) };
  }
}
