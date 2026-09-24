import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { ActivityNotificationsService } from '../notifications/activity-notifications.service';
import { langForCountry, LOCALE } from '../email/language';
import { appointmentReviewUrl, verifyReviewToken } from './appointment-link';
import { unsubscribeLinks } from './marketing-unsubscribe';
import { BarbershopService } from './barbershop.service';

// O e-mail sai algumas horas depois do fim do atendimento (a pessoa já foi
// embora, mas ainda lembra de como foi) e só pra atendimentos recentes —
// nunca uma avalanche de pedidos de coisas antigas
const SEND_AFTER_MS = 2 * 3_600_000;
const MAX_AGE_MS = 3 * 86_400_000;
// Cliente de sempre não recebe o pedido a cada corte
const MIN_DAYS_BETWEEN_REQUESTS = 60;
const BATCH_SIZE = 500;
const MAX_COMMENT = 1000;

/**
 * Pedido de avaliação depois do atendimento, como no Booksy: e-mail "como
 * foi?" com as estrelas e um link pra avaliar sem login nem conta. Uma vez
 * por atendimento, só pra quem ainda não avaliou a unidade e não recebeu
 * outro pedido há pouco; quem se descadastrou dos e-mails não recebe.
 */
@Injectable()
export class ReviewRequestService {
  private readonly logger = new Logger(ReviewRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationQueue: NotificationQueueService,
    private readonly activity: ActivityNotificationsService,
    private readonly barbershopService: BarbershopService,
  ) {}

  /**
   * Link de avaliação de um atendimento concluído, pra equipe mandar ao
   * cliente (WhatsApp, por exemplo) — inclusive pra quem não tem e-mail.
   */
  async staffReviewLink(userId: number, barbershopId: number, appointmentId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'reception');
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      select: { id: true, status: true },
    });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    if (appt.status !== 'COMPLETED') {
      throw new BadRequestException('Só dá pra pedir avaliação de atendimento concluído');
    }
    return appointmentReviewUrl(appt.id);
  }

  async enqueueDueRequests(now = new Date()) {
    const due = await this.prisma.appointment.findMany({
      where: {
        status: 'COMPLETED',
        reviewRequestSentAt: null,
        endAt: {
          gte: new Date(now.getTime() - MAX_AGE_MS),
          lte: new Date(now.getTime() - SEND_AFTER_MS),
        },
      },
      include: {
        customer: true,
        barbershop: true,
        barber: { select: { name: true } },
        services: { include: { service: { select: { name: true } } } },
      },
      orderBy: { endAt: 'asc' },
      take: BATCH_SIZE,
    });

    let enqueued = 0;
    for (const appt of due) {
      // Reserva (update condicional): duas execuções não mandam duas vezes.
      // Quem é pulado também fica marcado — não volta a ser avaliado
      const claimed = await this.prisma.appointment.updateMany({
        where: { id: appt.id, reviewRequestSentAt: null },
        data: { reviewRequestSentAt: now },
      });
      if (claimed.count === 0) continue;
      const customer = appt.customer;
      if (!customer.email || customer.marketingOptOut) continue;
      if (await this.alreadyReviewed(appt.barbershopId, customer.id, customer.clientAccountId)) {
        continue;
      }
      const recent = await this.prisma.appointment.findFirst({
        where: {
          id: { not: appt.id },
          barbershopId: appt.barbershopId,
          customerId: customer.id,
          reviewRequestSentAt: {
            gte: new Date(now.getTime() - MIN_DAYS_BETWEEN_REQUESTS * 86_400_000),
            lt: now,
          },
        },
        select: { id: true },
      });
      if (recent) continue;

      const shop = appt.barbershop;
      const lang = langForCountry(shop.country);
      const unsubscribe = unsubscribeLinks(customer.id);
      try {
        await this.notificationQueue.email(
          {
            kind: 'customer',
            loggedAgainstUserId: shop.ownerUserId ?? 0,
            template: 'review_request',
            context: {
              CustomerName: customer.name.split(' ')[0],
              BarbershopName: shop.name,
              BarberName: appt.barber.name,
              ServiceNames:
                appt.services
                  .map((s) => s.service?.name)
                  .filter(Boolean)
                  .join(', ') || '-',
              AppointmentDate: appt.startAt.toLocaleDateString(LOCALE[lang], {
                timeZone: shop.timezone,
              }),
              // Uma estrela = um link: tocar já abre a página com a nota marcada
              Stars: [1, 2, 3, 4, 5].map((n) => ({ N: n, URL: appointmentReviewUrl(appt.id, n) })),
              ReviewURL: appointmentReviewUrl(appt.id),
              UnsubscribeURL: unsubscribe.page,
              Year: now.getFullYear(),
            },
            subject: {
              pt: `Como foi em ${shop.name}?`,
              en: `How was your visit to ${shop.name}?`,
              es: `¿Qué tal en ${shop.name}?`,
            },
            lang,
            meta: 'review-request',
            to: customer.email,
            headers: unsubscribe.headers,
          },
          `review-request-${appt.id}`,
        );
        enqueued++;
      } catch (err) {
        // Não enfileirou (Redis fora): libera pra próxima execução
        this.logger.error(`Erro ao enfileirar pedido de avaliação #${appt.id}:`, err);
        await this.prisma.appointment
          .update({ where: { id: appt.id }, data: { reviewRequestSentAt: null } })
          .catch(() => undefined);
      }
    }
    if (enqueued) this.logger.log(`Pedidos de avaliação enfileirados: ${enqueued}`);
    return enqueued;
  }

  private async alreadyReviewed(
    barbershopId: number,
    customerId: number,
    clientAccountId: number | null,
  ) {
    const review = await this.prisma.review.findFirst({
      where: {
        barbershopId,
        OR: [{ customerId }, ...(clientAccountId ? [{ clientAccountId }] : [])],
      },
      select: { id: true },
    });
    return Boolean(review);
  }

  private async loadByToken(token: string) {
    const id = verifyReviewToken(token);
    const appt = id
      ? await this.prisma.appointment.findUnique({
          where: { id },
          include: {
            customer: true,
            barbershop: true,
            barber: { select: { name: true } },
            services: { include: { service: { select: { name: true } } } },
          },
        })
      : null;
    // Só atendimento concluído vira avaliação (como no login: cliente de verdade)
    if (!appt || appt.status !== 'COMPLETED') {
      throw new NotFoundException('Link inválido ou atendimento não encontrado');
    }
    return appt;
  }

  /** A avaliação desse cliente nessa unidade (pela ficha ou pela conta). */
  private findExisting(barbershopId: number, customerId: number, clientAccountId: number | null) {
    return this.prisma.review.findFirst({
      where: {
        barbershopId,
        OR: [{ customerId }, ...(clientAccountId ? [{ clientAccountId }] : [])],
      },
      // A da conta vale mais (é a que o cliente edita logado)
      orderBy: [{ clientAccountId: { sort: 'asc', nulls: 'last' } }],
    });
  }

  /** Página do link: o atendimento e a avaliação que o cliente já deixou. */
  async getReviewRequest(token: string) {
    const appt = await this.loadByToken(token);
    const existing = await this.findExisting(
      appt.barbershopId,
      appt.customerId,
      appt.customer.clientAccountId,
    );
    return {
      barbershopName: appt.barbershop.name,
      barbershopSlug: appt.barbershop.slug,
      customerName: appt.customer.name.split(' ')[0],
      barberName: appt.barber.name,
      serviceNames: appt.services
        .map((s) => s.service?.name)
        .filter(Boolean)
        .join(', '),
      startAt: appt.startAt.toISOString(),
      timezone: appt.barbershop.timezone,
      rating: existing?.rating ?? null,
      comment: existing?.comment ?? null,
    };
  }

  /**
   * Avaliar pelo link. Uma avaliação por cliente e unidade (mandar de novo
   * atualiza a mesma); se o cliente tem conta e já avaliou logado, é essa
   * que muda.
   */
  async submitReview(token: string, rating: number, comment?: string | null) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('A nota deve ser um número inteiro entre 1 e 5.');
    }
    const text = comment?.trim() || null;
    if (text && text.length > MAX_COMMENT) {
      throw new BadRequestException(`Comentário com no máximo ${MAX_COMMENT} caracteres.`);
    }
    const appt = await this.loadByToken(token);
    const { barbershopId, customerId } = appt;
    const clientAccountId = appt.customer.clientAccountId;
    const existing = await this.findExisting(barbershopId, customerId, clientAccountId);
    if (existing) {
      await this.prisma.review.update({
        where: { id: existing.id },
        data: { rating, comment: text },
      });
    } else {
      // Dois envios ao mesmo tempo: o índice único (unidade + ficha) segura
      // o segundo, que vira atualização
      await this.prisma.review.upsert({
        where: { barbershopId_customerId: { barbershopId, customerId } },
        create: { barbershopId, customerId, clientAccountId, rating, comment: text },
        update: { rating, comment: text },
      });
    }
    void this.activity.reviewPosted(
      barbershopId,
      clientAccountId,
      rating,
      text,
      appt.customer.name,
    );
    return { barbershopSlug: appt.barbershop.slug };
  }
}
