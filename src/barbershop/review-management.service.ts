import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { langForCountry } from '../email/language';
import { unsubscribeLinks } from './marketing-unsubscribe';

const MAX_REPLY = 1000;
const MAX_REASON = 500;

const reviewerName = (r: {
  clientAccount: { name: string } | null;
  customer: { name: string } | null;
}) => r.clientAccount?.name ?? r.customer?.name ?? 'Cliente';

/**
 * Avaliações do lado da unidade e da plataforma, como no Booksy:
 * - dono e gerente veem todas, respondem publicamente (a resposta aparece
 *   na página da unidade) e denunciam as abusivas;
 * - o admin da plataforma modera as denunciadas: oculta (sai da página e da
 *   nota média) ou mantém. A unidade não apaga avaliação.
 */
@Injectable()
export class ReviewManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershopService: BarbershopService,
    private readonly notificationQueue: NotificationQueueService,
  ) {}

  private include = {
    clientAccount: { select: { name: true } },
    customer: { select: { name: true } },
  } as const;

  private async findInShop(barbershopId: number, reviewId: number) {
    const review = await this.prisma.review.findFirst({ where: { id: reviewId, barbershopId } });
    if (!review) throw new NotFoundException('Avaliação não encontrada');
    return review;
  }

  async listForShop(userId: number, barbershopId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const reviews = await this.prisma.review.findMany({
      where: { barbershopId },
      include: this.include,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      reviewerName: reviewerName(r),
      reply: r.reply,
      repliedAt: r.repliedAt,
      reportedAt: r.reportedAt,
      reportReason: r.reportReason,
      hidden: r.hiddenAt != null,
    }));
  }

  /** Responde (ou edita a resposta); vazio apaga a resposta. */
  async reply(userId: number, barbershopId: number, reviewId: number, text?: string | null) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const before = await this.findInShop(barbershopId, reviewId);
    const reply = text?.trim() || null;
    if (reply && reply.length > MAX_REPLY) {
      throw new BadRequestException(`Resposta com no máximo ${MAX_REPLY} caracteres`);
    }
    await this.prisma.review.update({
      where: { id: reviewId },
      data: reply
        ? { reply, repliedAt: new Date(), repliedByUserId: userId }
        : { reply: null, repliedAt: null, repliedByUserId: null },
    });
    // Primeira resposta: o cliente fica sabendo (editar depois não reenvia)
    if (reply && !before.reply) {
      await this.notifyReviewer(reviewId, reply).catch(() => undefined);
    }
    return true;
  }

  /**
   * E-mail pro cliente com a resposta da unidade e o link pra página. Vai
   * pro e-mail da conta (avaliou logado) ou da ficha (avaliou pelo link);
   * quem se descadastrou dos e-mails não recebe.
   */
  private async notifyReviewer(reviewId: number, reply: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        barbershop: true,
        clientAccount: { select: { name: true, email: true } },
        customer: { select: { id: true, name: true, email: true, marketingOptOut: true } },
      },
    });
    if (!review) return;
    const customer = review.customer;
    if (customer?.marketingOptOut) return;
    const to = review.clientAccount?.email || customer?.email;
    // Conta excluída (LGPD) fica com e-mail inválido
    if (!to || to.endsWith('.invalid')) return;
    const shop = review.barbershop;
    const lang = langForCountry(shop.country);
    const unsubscribe = customer ? unsubscribeLinks(customer.id) : null;
    const front = process.env.FRONTEND_URL || 'http://localhost:5173';
    const name = (review.clientAccount?.name ?? customer?.name ?? '').split(' ')[0];
    await this.notificationQueue.email(
      {
        kind: 'customer',
        loggedAgainstUserId: shop.ownerUserId ?? 0,
        template: 'review_reply',
        context: {
          CustomerName: name,
          BarbershopName: shop.name,
          Rating: review.rating,
          Comment: review.comment,
          Reply: reply,
          PageURL: `${front}/u/${shop.slug}`,
          UnsubscribeURL: unsubscribe?.page ?? null,
          Year: new Date().getFullYear(),
        },
        subject: {
          pt: `${shop.name} respondeu sua avaliação`,
          en: `${shop.name} replied to your review`,
          es: `${shop.name} respondió a tu reseña`,
        },
        lang,
        meta: 'review-reply',
        to,
        ...(unsubscribe ? { headers: unsubscribe.headers } : {}),
      },
      `review-reply-${reviewId}-${Date.now()}`,
    );
  }

  /** Denuncia uma avaliação abusiva pra moderação da plataforma. */
  async report(userId: number, barbershopId: number, reviewId: number, reason: string) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const review = await this.findInShop(barbershopId, reviewId);
    const text = reason?.trim();
    if (!text) throw new BadRequestException('Conte o motivo da denúncia');
    if (text.length > MAX_REASON) {
      throw new BadRequestException(`Motivo com no máximo ${MAX_REASON} caracteres`);
    }
    if (review.hiddenAt) throw new BadRequestException('Esta avaliação já foi ocultada');
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { reportedAt: new Date(), reportReason: text },
    });
    return true;
  }

  // ---- admin da plataforma ----

  /** Denúncias em aberto e as já ocultadas (pra poder voltar atrás). */
  async listForModeration() {
    const reviews = await this.prisma.review.findMany({
      where: { OR: [{ reportedAt: { not: null } }, { hiddenAt: { not: null } }] },
      include: { ...this.include, barbershop: { select: { name: true, slug: true } } },
      orderBy: [{ reportedAt: { sort: 'desc', nulls: 'last' } }],
      take: 200,
    });
    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      reviewerName: reviewerName(r),
      reply: r.reply,
      repliedAt: r.repliedAt,
      reportedAt: r.reportedAt,
      reportReason: r.reportReason,
      hidden: r.hiddenAt != null,
      barbershopName: r.barbershop.name,
      barbershopSlug: r.barbershop.slug,
    }));
  }

  /**
   * hide = true: oculta (sai da página e da nota). hide = false: mantém
   * publicada e encerra a denúncia (ou volta a mostrar uma oculta).
   */
  async moderate(reviewId: number, hide: boolean) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Avaliação não encontrada');
    await this.prisma.review.update({
      where: { id: reviewId },
      data: hide
        ? { hiddenAt: new Date() }
        : { hiddenAt: null, reportedAt: null, reportReason: null },
    });
    return true;
  }
}
