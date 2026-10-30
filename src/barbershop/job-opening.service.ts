import { must } from '../common/must';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import type Stripe from 'stripe';
import { Prisma, TreatmentCategory } from '@prisma/client';
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
import { BarbershopService, currentManagers } from './barbershop.service';
import { EmployeeInviteService } from './employee-invite.service';
import { StripeService } from '@/stripe/stripe.service';
import { stripeConfigured } from './stripe-configured';
import { PLATFORM_CURRENCY, currentPricing } from '@/pricing/pricing';
import { normalizeLang, type Lang } from '@/email/language';

type Notice = Record<Lang, { title: string; message: string }>;

const FEE_KIND = 'job_fill_fee';

export const JOB_OPENING_FULL_MESSAGE = 'Os lugares desta vaga já foram preenchidos.';
export const JOB_OPENING_ENDED_MESSAGE = 'O período desta vaga já acabou.';

/** Vaga encerrada porque o período acabou (item 282) */
const ENDED_NOTICE = (title: string): Notice => ({
  pt: {
    title: 'Vaga encerrada',
    message: `O período da vaga "${title}" acabou e ela foi encerrada.`,
  },
  en: {
    title: 'Opening closed',
    message: `The period for "${title}" is over and the opening was closed.`,
  },
  es: {
    title: 'Vacante cerrada',
    message: `El período de la vacante "${title}" terminó y se cerró.`,
  },
});

export const JOB_APPLICANT_DELETED_MESSAGE =
  'Esta conta foi excluída: a candidatura não pode mais ser aceita.';

/** Candidato aceito que não entrou: a vaga não é mais dele */
const RELEASED_NOTICE = (title: string): Notice => ({
  pt: {
    title: 'Convite da vaga encerrado',
    message: `O convite da vaga "${title}" não foi aceito a tempo e deixou de valer.`,
  },
  en: {
    title: 'Opening invite ended',
    message: `The invite for "${title}" wasn't accepted in time and is no longer valid.`,
  },
  es: {
    title: 'Invitación de la vacante cerrada',
    message: `La invitación de la vacante "${title}" no se aceptó a tiempo y dejó de valer.`,
  },
});

/** Para quem aceitou (e pagou): a pessoa não entrou, a taxa volta */
const PAYER_NOTICE = (title: string, refunded: boolean): Notice => ({
  pt: {
    title: 'Candidato não entrou na equipe',
    message: `O convite da vaga "${title}" não foi aceito.${
      refunded ? ' A taxa paga foi devolvida no cartão.' : ''
    }`,
  },
  en: {
    title: "Candidate didn't join",
    message: `The invite for "${title}" wasn't accepted.${
      refunded ? ' The fee was refunded to your card.' : ''
    }`,
  },
  es: {
    title: 'El candidato no entró al equipo',
    message: `La invitación de la vacante "${title}" no se aceptó.${
      refunded ? ' La tarifa pagada se devolvió a la tarjeta.' : ''
    }`,
  },
});

/** Candidaturas por lote na rotina de liberação */
const RELEASE_BATCH = 500;
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
    @Inject(forwardRef(() => BarbershopService))
    private readonly barbershops: BarbershopService,
    private readonly invites: EmployeeInviteService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    @Optional() private readonly stripe?: StripeService,
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
    // Vaga cujo período acabou não ocupa o limite (item 282)
    const open = await this.prisma.jobOpening.count({
      where: { barbershopId: input.barbershopId, status: 'open', endDate: { gte: today } },
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
        {
          pt: {
            title: 'Vaga encerrada',
            message: `A vaga "${opening.title}" foi encerrada pela unidade.`,
          },
          en: {
            title: 'Opening closed',
            message: `The opening "${opening.title}" was closed by the location.`,
          },
          es: {
            title: 'Vacante cerrada',
            message: `La vacante "${opening.title}" fue cerrada por el local.`,
          },
        },
        '/jobs',
      );
    }
    return this.forShop(userId, barbershopId, id);
  }

  /** Aceita: cria o convite com o período da vaga; o profissional aceita pelo e-mail */
  // ============ TAXA POR VAGA PREENCHIDA ============

  /** Quanto custa aceitar agora (valor de "Preços e taxas"); sem Stripe ou 0, não cobra */
  fillFee() {
    const feeCents = currentPricing().jobFillFeeCents;
    return {
      feeCents,
      currency: PLATFORM_CURRENCY,
      required: feeCents > 0 && stripeConfigured() && !!this.stripe,
    };
  }

  /** Começa (ou retoma) o pagamento da taxa: client secret pro cartão */
  async startAcceptPayment(userId: number, barbershopId: number, applicationId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    const fee = this.fillFee();
    if (!fee.required || !this.stripe)
      throw new BadRequestException('Esta vaga não tem taxa agora');
    const application = await this.pendingApplication(barbershopId, applicationId);
    if (application.feePaidAt)
      throw new BadRequestException('A taxa desta candidatura já foi paga');
    // Sem vaga no plano, o convite falharia: avisa antes de cobrar
    await this.barbershops.ensureBarberLimitNotExceeded(barbershopId);

    if (application.feePaymentIntentId) {
      const existing = await this.stripe.retrievePaymentIntent(application.feePaymentIntentId);
      if (existing.status === 'succeeded') {
        await this.finalizeFee(existing);
        throw new BadRequestException('A taxa acabou de ser confirmada');
      }
      if (existing.status !== 'canceled' && existing.amount === fee.feeCents) {
        return {
          clientSecret: existing.client_secret,
          feeCents: fee.feeCents,
          currency: fee.currency,
        };
      }
      if (existing.status !== 'canceled') {
        await this.stripe.cancelPaymentIntent(existing.id).catch(() => undefined);
      }
    }
    const intent = await this.stripe.createPaymentIntent(
      fee.feeCents,
      fee.currency.toLowerCase(),
      undefined,
      {
        metadata: { kind: FEE_KIND, applicationId: String(applicationId) },
        description: `Taxa da vaga "${application.jobOpening.title}"`,
      },
    );
    await this.prisma.jobApplication.update({
      where: { id: applicationId },
      data: { feePaymentIntentId: intent.id, feeCents: fee.feeCents, feePayerUserId: userId },
    });
    return { clientSecret: intent.client_secret, feeCents: fee.feeCents, currency: fee.currency };
  }

  /** A tela voltou do cartão: confere no Stripe; pago, aceita */
  async confirmAcceptPayment(userId: number, barbershopId: number, applicationId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    const application = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, jobOpening: { barbershopId } },
      select: { feePaymentIntentId: true, status: true },
    });
    if (!application?.feePaymentIntentId || !this.stripe) {
      throw new BadRequestException('Pagamento não iniciado');
    }
    const ok = await this.finalizeFee(
      await this.stripe.retrievePaymentIntent(application.feePaymentIntentId),
    );
    return {
      paid: ok,
      opening: await this.forShop(
        userId,
        barbershopId,
        must(await this.openingOf(applicationId), 'vaga da candidatura'),
      ),
    };
  }

  private async openingOf(applicationId: number) {
    return (
      await this.prisma.jobApplication.findUnique({
        where: { id: applicationId },
        select: { jobOpeningId: true },
      })
    )?.jobOpeningId;
  }

  /**
   * Taxa paga (tela ou webhook): aceita a candidatura. Idempotente. Se o
   * aceite não der mais certo (já respondida, vaga fechada, convite
   * recusado), a taxa volta para o cartão.
   */
  async finalizeFee(intent: Stripe.PaymentIntent): Promise<boolean> {
    if (intent.status !== 'succeeded' || intent.metadata?.kind !== FEE_KIND) return false;
    const applicationId = Number(intent.metadata?.applicationId);
    const application = Number.isInteger(applicationId)
      ? await this.prisma.jobApplication.findUnique({
          where: { id: applicationId },
          include: { jobOpening: { select: { barbershopId: true } } },
        })
      : null;
    if (!application || application.feePaymentIntentId !== intent.id) {
      this.logger.warn(`Pagamento ${intent.id} sem candidatura de vaga`);
      return false;
    }
    if (application.feePaidAt) return application.status === 'accepted';
    if (intent.amount < (application.feeCents ?? 0)) return false;
    const claimed = await this.prisma.jobApplication.updateMany({
      where: { id: applicationId, feePaidAt: null },
      data: { feePaidAt: new Date() },
    });
    if (claimed.count === 0) return true;
    try {
      await this.acceptNow(
        must(application.feePayerUserId, 'quem pagou a taxa'),
        application.jobOpening.barbershopId,
        applicationId,
      );
      return true;
    } catch (err) {
      this.logger.warn(`Taxa paga mas o aceite falhou (#${applicationId}): ${err}; devolvendo`);
      await this.stripe
        ?.createRefund(intent.id, undefined, 'requested_by_customer', `job-fee-refund-${intent.id}`)
        .catch((e) => this.logger.error(`Erro ao devolver a taxa ${intent.id}:`, e));
      // Devolvida: não conta como paga (um aceite depois pede a taxa de novo)
      await this.prisma.jobApplication.update({
        where: { id: applicationId },
        data: { feeRefundedAt: new Date(), feePaidAt: null, feePaymentIntentId: null },
      });
      return false;
    }
  }

  private async pendingApplication(barbershopId: number, applicationId: number) {
    const application = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, jobOpening: { barbershopId } },
      include: { jobOpening: true },
    });
    if (!application) throw new NotFoundException('Candidatura não encontrada');
    if (application.status !== 'pending') {
      throw new BadRequestException('Esta candidatura já foi respondida');
    }
    if (application.jobOpening.status !== 'open') {
      throw new BadRequestException('A vaga não está mais aberta');
    }
    if (application.jobOpening.endDate < (await this.today(barbershopId)).today) {
      throw new BadRequestException(JOB_OPENING_ENDED_MESSAGE);
    }
    return application;
  }

  /** Aceita (sem taxa, ou a taxa já paga): vira convite com o período da vaga */
  async accept(userId: number, barbershopId: number, applicationId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    if (this.fillFee().required) {
      const paid = await this.prisma.jobApplication.findFirst({
        where: { id: applicationId, feePaidAt: { not: null } },
        select: { id: true },
      });
      if (!paid) throw new BadRequestException('Pague a taxa da vaga para aceitar');
    }
    return this.acceptNow(userId, barbershopId, applicationId);
  }

  private async acceptNow(userId: number, barbershopId: number, applicationId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    const application = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, jobOpening: { barbershopId } },
      include: {
        jobOpening: true,
        user: {
          select: { id: true, email: true, fullName: true, phone: true, deleted_at: true },
        },
      },
    });
    if (!application) throw new NotFoundException('Candidatura não encontrada');
    // Conta excluída: o convite iria para um e-mail que ninguém recebe
    if (application.user.deleted_at) {
      throw new BadRequestException(JOB_APPLICANT_DELETED_MESSAGE);
    }
    if (application.status !== 'pending') {
      throw new BadRequestException('Esta candidatura já foi respondida');
    }
    const opening = application.jobOpening;
    if (opening.status !== 'open') throw new BadRequestException('A vaga não está mais aberta');

    const { timeZone, today } = await this.today(barbershopId);
    if (opening.endDate < today) throw new BadRequestException(JOB_OPENING_ENDED_MESSAGE);
    // Do começo do primeiro dia ao fim do último, no fuso da unidade
    const accessStartsAt = zonedTimeToUtc(opening.startDate, 0, timeZone);
    const accessEndsAt = new Date(
      zonedTimeToUtc(nextDateStr(opening.endDate), 0, timeZone).getTime() - 1,
    );
    // Sob a trava da vaga: aceites ao mesmo tempo (dois gerentes, duas abas,
    // a taxa paga pelo webhook) contam um de cada vez e não passam dos
    // lugares (item 341). A candidatura também só é aceita uma vez.
    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'job-opening:' + opening.id}))`;
      const current = await tx.jobOpening.findUnique({
        where: { id: opening.id },
        select: { status: true, slots: true },
      });
      if (current?.status !== 'open') {
        throw new BadRequestException('A vaga não está mais aberta');
      }
      const alreadyAccepted = await tx.jobApplication.count({
        where: { jobOpeningId: opening.id, status: 'accepted' },
      });
      if (alreadyAccepted >= current.slots) {
        throw new BadRequestException(JOB_OPENING_FULL_MESSAGE);
      }
      return tx.jobApplication.updateMany({
        where: { id: applicationId, status: 'pending' },
        data: { status: 'accepted', decidedAt: new Date() },
      });
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
      await this.rejectPending(opening.id, {
        pt: {
          title: 'Vaga preenchida',
          message: `A vaga "${opening.title}" foi preenchida.`,
        },
        en: {
          title: 'Position filled',
          message: `The opening "${opening.title}" has been filled.`,
        },
        es: {
          title: 'Vacante cubierta',
          message: `La vacante "${opening.title}" ya fue cubierta.`,
        },
      });
    }
    await this.notify(
      [application.userId],
      {
        pt: {
          title: 'Candidatura aceita',
          message: `Você foi aceito na vaga "${opening.title}". Aceite o convite que chegou no seu e-mail para entrar na equipe.`,
        },
        en: {
          title: 'Application accepted',
          message: `You were accepted for "${opening.title}". Accept the invite in your email to join the team.`,
        },
        es: {
          title: 'Postulación aceptada',
          message: `Te aceptaron en la vacante "${opening.title}". Acepta la invitación de tu correo para entrar al equipo.`,
        },
      },
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
    const title = application.jobOpening.title;
    await this.notify(
      [application.userId],
      {
        pt: {
          title: 'Candidatura não aceita',
          message: `A unidade não seguiu com a sua candidatura para "${title}".`,
        },
        en: {
          title: 'Application not accepted',
          message: `The location did not move forward with your application for "${title}".`,
        },
        es: {
          title: 'Postulación no aceptada',
          message: `El local no siguió con tu postulación para "${title}".`,
        },
      },
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
    // Janela larga: cada unidade filtra pelo próprio fuso logo abaixo.
    const horizon = addDaysStr(toZonedParts(new Date(), 'UTC').dateStr, -2);
    const rawCity = filters.city?.trim();
    const city = rawCity?.replace(/[%_\\]/g, '');
    const openings = await this.prisma.jobOpening.findMany({
      where: {
        status: 'open',
        endDate: { gte: horizon },
        barbershop: {
          isActive: true,
          ...(rawCity
            ? city
              ? { city: { contains: city, mode: 'insensitive' } }
              : { id: -1 }
            : {}),
        },
        ...(filters.category ? { OR: [{ category: filters.category }, { category: null }] } : {}),
      },
      include: {
        barbershop: { select: { name: true, slug: true, city: true, state: true, timezone: true } },
        applications: { where: { userId }, select: { id: true, status: true } },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    const myShops = new Set(await this.myShopIds(userId));
    return openings
      .filter((o) => {
        const shopToday = toZonedParts(new Date(), safeTimeZone(o.barbershop.timezone)).dateStr;
        return o.endDate >= addDaysStr(shopToday, -1) && !myShops.has(o.barbershopId);
      })
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
      include: {
        barbershop: {
          select: {
            isActive: true,
            platformSuspendedAt: true,
            network: { select: { platformSuspendedAt: true } },
          },
        },
      },
    });
    if (
      !opening ||
      !opening.barbershop.isActive ||
      opening.barbershop.platformSuspendedAt ||
      opening.barbershop.network.platformSuspendedAt
    )
      throw new NotFoundException('Vaga não encontrada');
    if (opening.status !== 'open') throw new BadRequestException('A vaga não está mais aberta');
    if (opening.endDate < (await this.today(opening.barbershopId)).today) {
      throw new BadRequestException(JOB_OPENING_ENDED_MESSAGE);
    }
    if ((await this.myShopIds(userId)).includes(opening.barbershopId)) {
      throw new ForbiddenException('Você já faz parte desta unidade');
    }
    const text = message?.trim() || null;
    if (text && text.length > 500)
      throw new BadRequestException('A mensagem vai até 500 caracteres');
    // Candidatura em vaga que já acabou não prende o limite (a rotina recusa)
    const pending = await this.prisma.jobApplication.count({
      where: {
        userId,
        status: 'pending',
        jobOpening: {
          status: 'open',
          endDate: { gte: addDaysStr(toZonedParts(new Date(), 'UTC').dateStr, -1) },
        },
      },
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
    if (existing?.returnedOnce) {
      throw new BadRequestException('Você já voltou a esta vaga.');
    }
    const application = existing
      ? await this.prisma.jobApplication.update({
          where: { id: existing.id },
          data: { status: 'pending', message: text, decidedAt: null, returnedOnce: true },
        })
      : await this.prisma.jobApplication.create({
          data: { jobOpeningId: openingId, userId, message: text },
        });

    // Reabrir a mesma candidatura não avisa de novo (o primeiro aviso fica)
    if (existing) return { id: application.id, status: application.status };

    const managers = await this.shopManagers(opening.barbershopId);
    const who = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    const name = who?.fullName ?? '';
    await this.notify(
      managers,
      {
        pt: {
          title: 'Nova candidatura',
          message: `${name || 'Um profissional'} se candidatou à vaga "${opening.title}".`,
        },
        en: {
          title: 'New application',
          message: `${name || 'A professional'} applied for "${opening.title}".`,
        },
        es: {
          title: 'Nueva postulación',
          message: `${name || 'Un profesional'} se postuló a la vacante "${opening.title}".`,
        },
      },
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
          where: currentManagers(),
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

  /** Unidade encerrada: as vagas abertas fecham e quem esperava resposta é avisado. */
  async closeOpeningsOfBarbershop(barbershopId: number) {
    const openings = await this.prisma.jobOpening.findMany({
      where: { barbershopId, status: 'open' },
      select: { id: true, title: true },
    });
    for (const opening of openings) {
      await this.prisma.jobOpening.updateMany({
        where: { id: opening.id, status: 'open' },
        data: { status: 'closed', closedAt: new Date() },
      });
      await this.rejectPending(opening.id, {
        pt: {
          title: 'Vaga encerrada',
          message: `A vaga "${opening.title}" foi encerrada porque a unidade encerrou o atendimento.`,
        },
        en: {
          title: 'Opening closed',
          message: `The opening "${opening.title}" was closed because the location stopped operating.`,
        },
        es: {
          title: 'Vacante cerrada',
          message: `La vacante "${opening.title}" se cerró porque la unidad dejó de atender.`,
        },
      });
    }
  }

  /** Quem ainda esperava resposta: recusa e avisa (vaga preenchida ou encerrada). */
  /**
   * Candidatura aceita que não virou equipe: o convite venceu, foi cancelado
   * (ou sumiu) ou o período da vaga acabou sem o aceite. A candidatura sai
   * (`expired`), o convite pendente deixa de valer, a taxa volta para quem
   * pagou e a vaga preenchida reabre se o período ainda não acabou (item 192).
   * Roda de hora em hora.
   */
  async releaseUnjoinedApplications(now = new Date()) {
    // Em lotes, até acabar. Quem já entrou na equipe ganha joinedAt e sai da
    // busca: antes eram sempre as mesmas 500, todas de quem já tinha entrado,
    // e as vencidas nunca entravam no lote (item 281)
    let released = 0;
    let afterId = 0;
    for (;;) {
      const batch = await this.prisma.jobApplication.findMany({
        where: { status: 'accepted', joinedAt: null, id: { gt: afterId } },
        include: { jobOpening: true },
        orderBy: { id: 'asc' },
        take: RELEASE_BATCH,
      });
      if (!batch.length) break;
      afterId = batch[batch.length - 1].id;
      released += await this.releaseBatch(batch, now);
      if (batch.length < RELEASE_BATCH) break;
    }
    await this.retryFailedRefunds();
    if (released)
      this.logger.log(`Vagas: ${released} candidatura(s) aceita(s) sem entrar na equipe`);
    return released;
  }

  /**
   * Taxa que a Stripe não devolveu na hora: a candidatura já saiu de
   * `accepted`, então a rotina de cima não a via mais e a taxa ficava com a
   * plataforma (item 280). Tenta de novo (a chave de idempotência é a mesma)
   * e avisa quem pagou quando sai.
   */
  async retryFailedRefunds() {
    const pending = await this.prisma.jobApplication.findMany({
      where: {
        status: 'expired',
        feePaidAt: { not: null },
        feeRefundedAt: null,
        feePaymentIntentId: { not: null },
      },
      include: { jobOpening: { select: { title: true, barbershopId: true } } },
      orderBy: { id: 'asc' },
      take: RELEASE_BATCH,
    });
    let refunded = 0;
    for (const application of pending) {
      if (!(await this.refundFee(application))) continue;
      refunded++;
      if (application.feePayerUserId) {
        await this.notify(
          [application.feePayerUserId],
          PAYER_NOTICE(application.jobOpening.title, true),
          `/barbershops/${application.jobOpening.barbershopId}/jobs`,
        );
      }
    }
    return refunded;
  }

  private async releaseBatch(
    accepted: Array<Prisma.JobApplicationGetPayload<{ include: { jobOpening: true } }>>,
    now: Date,
  ) {
    const inviteIds = accepted.map((a) => a.inviteId).filter((id): id is number => id != null);
    const invites = new Map(
      (
        await this.prisma.employeeInvite.findMany({
          where: { id: { in: inviteIds } },
          select: { id: true, status: true, expiresAt: true, barberId: true },
        })
      ).map((i) => [i.id, i]),
    );
    let released = 0;
    for (const application of accepted) {
      const invite = application.inviteId != null ? invites.get(application.inviteId) : undefined;
      if (invite?.status === 'ACCEPTED') {
        await this.prisma.jobApplication.updateMany({
          where: { id: application.id, joinedAt: null },
          data: { joinedAt: now },
        });
        continue;
      }
      const opening = application.jobOpening;
      const { today } = await this.today(opening.barbershopId);
      const periodOver = opening.endDate < today;
      const lapsed = !invite || invite.status !== 'PENDING' || invite.expiresAt < now || periodOver;
      if (!lapsed) continue;
      const claimed = await this.prisma.jobApplication.updateMany({
        where: { id: application.id, status: 'accepted' },
        data: { status: 'expired', decidedAt: now },
      });
      if (claimed.count === 0) continue;
      released++;
      if (invite?.status === 'PENDING') {
        await this.prisma.$transaction([
          this.prisma.employeeInvite.updateMany({
            where: { id: invite.id, status: 'PENDING' },
            data: { status: 'EXPIRED' },
          }),
          // O cadastro nasceu do convite e ninguém aceitou: sai da equipe ativa
          this.prisma.barber.updateMany({
            where: { id: invite.barberId, userId: null },
            data: { isActive: false },
          }),
        ]);
      }
      const refunded = await this.refundFee(application);
      if (opening.status === 'filled' && !periodOver) {
        await this.prisma.jobOpening.updateMany({
          where: { id: opening.id, status: 'filled' },
          data: { status: 'open' },
        });
      }
      await this.notify([application.userId], RELEASED_NOTICE(opening.title), '/jobs');
      if (application.feePayerUserId) {
        await this.notify(
          [application.feePayerUserId],
          PAYER_NOTICE(opening.title, refunded),
          `/barbershops/${opening.barbershopId}/jobs`,
        );
      }
    }
    return released;
  }

  /**
   * Vaga cujo período acabou (no fuso da unidade) fecha, e quem esperava
   * resposta é recusado com aviso. Antes ela ficava aberta para sempre:
   * ocupava o limite da unidade e prendia as candidaturas (item 282).
   */
  async closeEndedOpenings() {
    const horizon = addDaysStr(toZonedParts(new Date(), 'UTC').dateStr, 1);
    const candidates = await this.prisma.jobOpening.findMany({
      where: { status: 'open', endDate: { lt: horizon } },
      select: { id: true, title: true, endDate: true, barbershopId: true },
      take: 500,
    });
    let closed = 0;
    for (const opening of candidates) {
      const { today } = await this.today(opening.barbershopId);
      if (opening.endDate >= today) continue;
      const done = await this.prisma.jobOpening.updateMany({
        where: { id: opening.id, status: 'open' },
        data: { status: 'closed', closedAt: new Date() },
      });
      if (done.count === 0) continue;
      closed++;
      await this.rejectPending(opening.id, ENDED_NOTICE(opening.title));
    }
    return closed;
  }

  /** Devolve a taxa paga (uma vez só); true se havia taxa a devolver */
  private async refundFee(application: {
    id: number;
    feePaidAt: Date | null;
    feeRefundedAt: Date | null;
    feePaymentIntentId: string | null;
  }) {
    if (!application.feePaidAt || application.feeRefundedAt || !application.feePaymentIntentId) {
      return false;
    }
    const claimed = await this.prisma.jobApplication.updateMany({
      where: { id: application.id, feeRefundedAt: null },
      data: { feeRefundedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    const intentId = application.feePaymentIntentId;
    try {
      await this.stripe?.createRefund(
        intentId,
        undefined,
        'requested_by_customer',
        `job-fee-refund-${intentId}`,
      );
    } catch (err) {
      this.logger.error(`Erro ao devolver a taxa da vaga ${intentId}:`, err);
      // Não devolveu: tenta de novo na próxima execução
      await this.prisma.jobApplication.update({
        where: { id: application.id },
        data: { feeRefundedAt: null },
      });
      return false;
    }
    return true;
  }

  private async rejectPending(openingId: number, texts: Notice) {
    const pending = await this.prisma.jobApplication.findMany({
      where: { jobOpeningId: openingId, status: 'pending' },
      select: { userId: true },
    });
    if (!pending.length) return;
    await this.prisma.jobApplication.updateMany({
      where: { jobOpeningId: openingId, status: 'pending' },
      data: { status: 'rejected', decidedAt: new Date() },
    });
    await this.notify(
      pending.map((a) => a.userId),
      texts,
      '/jobs',
    );
  }

  /** Aviso no idioma de cada pessoa (configuração da conta; sem ela, português). */
  private async notify(userIds: number[], texts: Notice, actionUrl: string) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, isActive: true, deleted_at: null },
      select: { id: true, userSystemConfig: { select: { language: true } } },
    });
    if (!users.length) return;
    const rows = users.map((user) => {
      const text = texts[normalizeLang(user.userSystemConfig?.language)];
      return {
        userId: user.id,
        title: text.title,
        message: text.message,
        type: NotificationType.INFO,
        actionUrl,
      };
    });
    try {
      await this.prisma.userNotification.createMany({ data: rows });
      for (const row of rows) this.realtime.notifyUsers([row.userId], 'CREATED', row.title);
      await this.push.sendToUsers(
        rows.map((row) => row.userId),
        (lang) => ({
          title: texts[lang].title,
          body: texts[lang].message,
          url: actionUrl,
          tag: 'jobs',
        }),
      );
    } catch (err) {
      this.logger.warn(`Aviso de vaga não enviado: ${err}`);
    }
  }
}
