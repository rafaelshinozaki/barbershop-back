import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { assertShopInService } from './public-shop';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { ActivityNotificationsService } from '../notifications/activity-notifications.service';
import { langForCountry, LOCALE } from '../email/language';
import { appointmentLinkCovers, appointmentReviewUrl, appointmentStaffReviewUrl, REVIEW_LINK_DAYS, reviewLinkRequester, verifyReviewToken } from './appointment-link';
import { unsubscribeLinks } from './marketing-unsubscribe';
import { BarbershopService } from './barbershop.service';
import { linkBarberToProfessional } from './professional';
import { reviewEditData } from './review-edit';
import { appointmentContactEmail } from './appointment-contact';
import { phoneForWhatsapp } from '../common/phone.util';
import { WhatsappService } from '../whatsapp/whatsapp.service';

// O e-mail sai algumas horas depois do fim do atendimento (a pessoa já foi
// embora, mas ainda lembra de como foi) e só pra atendimentos recentes —
// nunca uma avalanche de pedidos de coisas antigas
const SEND_AFTER_MS = 2 * 3_600_000;
const MAX_AGE_MS = 3 * 86_400_000;
const BATCH_SIZE = 500;
const MAX_COMMENT = 1000;

/** Nota de 1 a 5 e comentário opcional (até MAX_COMMENT) */
function checkReview(rating: number, comment?: string | null) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new BadRequestException('A nota deve ser um número inteiro entre 1 e 5.');
  }
  const text = comment?.trim() || null;
  if (text && text.length > MAX_COMMENT) {
    throw new BadRequestException(`Comentário com no máximo ${MAX_COMMENT} caracteres.`);
  }
  return text;
}

/**
 * Fechamento do atendimento: um e-mail "como foi?" por atendimento
 * concluído, com as estrelas e um link pra avaliar sem login nem conta. O
 * link avalia o profissional daquele atendimento e a unidade (no modo solo
 * não há unidade: a nota é uma só). Quem se descadastrou dos e-mails não
 * recebe.
 */
@Injectable()
export class ReviewRequestService {
  private readonly logger = new Logger(ReviewRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationQueue: NotificationQueueService,
    private readonly activity: ActivityNotificationsService,
    private readonly barbershopService: BarbershopService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /**
   * A equipe pede a avaliação: o sistema manda o link pro e-mail ou pro
   * WhatsApp do próprio cliente. O link não volta pra tela.
   */
  async staffReviewLink(userId: number, barbershopId: number, appointmentId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'reception');
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      include: {
        customer: true,
        barbershop: true,
        barber: { select: { name: true } },
        services: { include: { service: { select: { name: true } } } },
        sale: { select: { paymentStatus: true } },
      },
    });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    if (appt.status !== 'COMPLETED') {
      throw new BadRequestException('Só dá pra pedir avaliação de atendimento concluído');
    }
    if (Date.now() > appt.endAt.getTime() + REVIEW_LINK_DAYS * 86_400_000) {
      throw new BadRequestException('Este atendimento já passou do prazo de 30 dias pra avaliar.');
    }
    const paid = appt.sale?.paymentStatus === 'PAID' || appt.sale?.paymentStatus === 'PARTIAL';
    if (!paid) {
      throw new BadRequestException('Este atendimento não tem pagamento registrado.');
    }
    if (appt.customer.marketingOptOut) {
      throw new BadRequestException('Este cliente pediu para não receber mensagens.');
    }
    const email = appointmentContactEmail(appt);
    const phone = phoneForWhatsapp(appt.customer.phone, appt.barbershop.country);
    if (!email && !phone) {
      throw new BadRequestException(
        'Este cliente não tem e-mail nem WhatsApp pra receber o pedido.',
      );
    }
    const url = (rating?: number) =>
      appointmentStaffReviewUrl(appt.id, userId, rating, appt.linkVersion);
    const now = new Date();
    try {
      if (email) {
        await this.notificationQueue.email(
          this.reviewEmailJob(appt, url, now, email),
          `review-request-staff-${appt.id}-${now.getTime()}`,
        );
      } else if (phone) {
        if (!this.whatsapp.isConfigured()) {
          throw new BadRequestException(
            'Não dá para enviar o WhatsApp agora e o cliente não tem e-mail.',
          );
        }
        const lang = langForCountry(appt.barbershop.country);
        const first = appt.customer.name.split(' ')[0];
        const text = {
          pt: `Oi, ${first}! Como foi com ${appt.barber.name} em ${appt.barbershop.name}? Avalie aqui: ${url()}`,
          en: `Hi ${first}! How was your visit with ${appt.barber.name} at ${appt.barbershop.name}? Rate it here: ${url()}`,
          es: `Hola, ${first}! ¿Qué tal con ${appt.barber.name} en ${appt.barbershop.name}? Evalúa aquí: ${url()}`,
        }[lang];
        await this.notificationQueue.whatsapp(
          { kind: 'marketing', to: phone, message: text, lang },
          `review-request-staff-wa-${appt.id}-${now.getTime()}`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Erro ao enviar pedido de avaliação #${appt.id}:`, err);
      throw new BadRequestException('Não foi possível enviar o pedido de avaliação. Tente de novo.');
    }
    return true;
  }

  async enqueueDueRequests(now = new Date()) {
    const due = await this.prisma.appointment.findMany({
      where: {
        status: 'COMPLETED',
        source: { notIn: ['HISTORY', 'IMPORT'] },
        reviewRequestSentAt: null,
        sale: { is: { paymentStatus: { in: ['PAID', 'PARTIAL'] } } },
        endAt: {
          gte: new Date(now.getTime() - MAX_AGE_MS),
          lte: new Date(now.getTime() - SEND_AFTER_MS),
        },
      },
      select: { id: true },
      orderBy: { endAt: 'asc' },
      take: BATCH_SIZE,
    });

    let enqueued = 0;
    for (const { id } of due) {
      // Um por vez: unidade apagada entre a busca e aqui (o agendamento vai
      // junto) só pula este, em vez de derrubar o lote inteiro
      const appt = await this.prisma.appointment
        .findUnique({
          where: { id },
          include: {
            customer: true,
            barbershop: true,
            barber: { select: { name: true } },
            services: { include: { service: { select: { name: true } } } },
          },
        })
        .catch(() => null);
      if (!appt) continue;
      // Reserva (update condicional): duas execuções não mandam duas vezes.
      // Quem é pulado também fica marcado — não volta a ser avaliado
      const claimed = await this.prisma.appointment.updateMany({
        where: { id: appt.id, reviewRequestSentAt: null },
        data: { reviewRequestSentAt: now },
      });
      if (claimed.count === 0) continue;
      const customer = appt.customer;
      const to = appointmentContactEmail(appt);
      if (!to || customer.marketingOptOut) continue;
      // Já avaliou esse atendimento (pelo link que a equipe mandou, por exemplo)
      const reviewed = await this.prisma.professionalReview.findUnique({
        where: { appointmentId: appt.id },
        select: { id: true },
      });
      if (reviewed) continue;

      try {
        await this.notificationQueue.email(
          this.reviewEmailJob(
            appt,
            (rating) => appointmentReviewUrl(appt.id, rating, appt.linkVersion),
            now,
            to,
          ),
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

  private reviewEmailJob(
    appt: {
      startAt: Date;
      customer: { id: number; name: string };
      barbershop: {
        name: string;
        country: string | null;
        timezone: string;
        ownerUserId: number | null;
        practiceKind: string;
      };
      barber: { name: string };
      services: { service: { name: string } | null }[];
    },
    reviewUrl: (rating?: number) => string,
    now: Date,
    to: string,
  ) {
    const shop = appt.barbershop;
    const lang = langForCountry(shop.country);
    const unsubscribe = unsubscribeLinks(appt.customer.id);
    return {
      kind: 'customer' as const,
      loggedAgainstUserId: shop.ownerUserId ?? 0,
      template: 'review_request',
      context: {
        CustomerName: appt.customer.name.split(' ')[0],
        BarbershopName: shop.name,
        BarberName: appt.barber.name,
        Solo: shop.practiceKind === 'solo',
        ServiceNames:
          appt.services
            .map((s) => s.service?.name)
            .filter(Boolean)
            .join(', ') || '-',
        AppointmentDate: appt.startAt.toLocaleDateString(LOCALE[lang], {
          timeZone: shop.timezone,
        }),
        Stars: [1, 2, 3, 4, 5].map((n) => ({ N: n, URL: reviewUrl(n) })),
        ReviewURL: reviewUrl(),
        UnsubscribeURL: unsubscribe.page,
        Year: now.getFullYear(),
      },
      subject: {
        pt: `Como foi com ${appt.barber.name} em ${shop.name}?`,
        en: `How was your appointment with ${appt.barber.name} at ${shop.name}?`,
        es: `¿Qué tal con ${appt.barber.name} en ${shop.name}?`,
      },
      lang,
      meta: 'review-request',
      to,
      headers: unsubscribe.headers,
    };
  }

  private async loadByToken(token: string) {
    const id = verifyReviewToken(token);
    const appt = id
      ? await this.prisma.appointment.findUnique({
          where: { id },
          include: {
            customer: true,
            barbershop: true,
            barber: { select: { name: true, userId: true, professionalId: true } },
            services: { include: { service: { select: { name: true } } } },
            professionalReview: true,
          },
        })
      : null;
    // Só atendimento concluído vira avaliação (como no login: cliente de verdade)
    if (
      !appt ||
      appt.status !== 'COMPLETED' ||
      !appointmentLinkCovers(token, 'appointment-review', appt)
    ) {
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
    // Unidade encerrada ou suspensa não recebe avaliação nova (item 190)
    await assertShopInService(this.prisma, appt.barbershopId);
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
      solo: appt.barbershop.practiceKind === 'solo',
      rating: existing?.rating ?? null,
      comment: existing?.comment ?? null,
      professionalRating: appt.professionalReview?.rating ?? null,
      professionalComment: appt.professionalReview?.comment ?? null,
    };
  }

  /**
   * Avaliar pelo link: o profissional (uma avaliação por atendimento) e a
   * unidade (uma por cliente e unidade: mandar de novo atualiza a mesma; se
   * o cliente tem conta e já avaliou logado, é essa que muda). Dá pra mandar
   * só uma das duas. No modo solo a nota do profissional vale também pra
   * página da unidade (é a mesma pessoa).
   */
  async submitReview(
    token: string,
    input: {
      rating?: number | null;
      comment?: string | null;
      professionalRating?: number | null;
      professionalComment?: string | null;
    },
  ) {
    const appt = await this.loadByToken(token);
    await assertShopInService(this.prisma, appt.barbershopId);
    const solo = appt.barbershop.practiceKind === 'solo';
    const pro =
      input.professionalRating != null
        ? {
            rating: input.professionalRating,
            comment: checkReview(input.professionalRating, input.professionalComment),
          }
        : null;
    let unit =
      input.rating != null
        ? { rating: input.rating, comment: checkReview(input.rating, input.comment) }
        : null;
    if (solo && pro) unit = pro;
    if (!pro && !unit) throw new BadRequestException('Dê uma nota de 1 a 5.');

    const { barbershopId, customerId } = appt;
    const clientAccountId = appt.customer.clientAccountId;
    const requestedByUserId = reviewLinkRequester(token);
    const origin = {
      reviewSource: requestedByUserId ? 'STAFF' : 'EMAIL',
      requestedByUserId,
    };
    if (pro) {
      // Profissional com conta: a avaliação vai pra identidade dele (soma nas
      // outras unidades e aparece em /p/:slug), criando o vínculo se faltar
      const professionalId =
        appt.barber.professionalId ??
        (appt.barber.userId
          ? (await linkBarberToProfessional(this.prisma, appt.barberId, appt.barber.userId)).id
          : null);
      await this.prisma.professionalReview.upsert({
        where: { appointmentId: appt.id },
        create: {
          appointmentId: appt.id,
          barberId: appt.barberId,
          barbershopId,
          professionalId,
          customerId,
          rating: pro.rating,
          comment: pro.comment,
          ...origin,
        },
        update: { rating: pro.rating, comment: pro.comment, professionalId, ...origin },
      });
    }
    if (unit) {
      const existing = await this.findExisting(barbershopId, customerId, clientAccountId);
      if (existing) {
        await this.prisma.review.update({
          where: { id: existing.id },
          data: { ...reviewEditData(existing, unit), ...origin },
        });
      } else {
        // Dois envios ao mesmo tempo: o índice único (unidade + ficha) segura
        // o segundo, que vira atualização
        await this.prisma.review.upsert({
          where: { barbershopId_customerId: { barbershopId, customerId } },
          create: {
            barbershopId,
            customerId,
            clientAccountId,
            rating: unit.rating,
            comment: unit.comment,
            ...origin,
          },
          update: { ...reviewEditData(null, unit), ...origin },
        });
      }
      void this.activity.reviewPosted(
        barbershopId,
        clientAccountId,
        unit.rating,
        unit.comment,
        appt.customer.name,
      );
    }
    return { barbershopSlug: appt.barbershop.slug };
  }
}
