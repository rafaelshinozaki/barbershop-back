import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAX_REPLY = 1000;
const PUBLIC_REVIEWS = 20;

/** "Carlos S." — o nome que aparece na página; sem ficha, "Cliente" */
export function reviewerLabel(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Cliente';
  const last = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : '';
  return `${parts[0]}${last}`;
}

/**
 * Avaliações do profissional (uma por atendimento, feitas pelo link do
 * fechamento): a nota e os comentários da página /p/:slug, somando todas as
 * unidades da conta, e a lista do próprio profissional pra responder.
 */
@Injectable()
export class ProfessionalReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nota média e quantas avaliações (as ocultadas pela moderação não contam) */
  async summary(professionalId: number) {
    const agg = await this.prisma.professionalReview.aggregate({
      where: { professionalId, hiddenAt: null },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return {
      averageRating: agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
      reviewCount: agg._count._all,
    };
  }

  /** Últimos comentários pra página pública, com a resposta do profissional */
  async publicReviews(professionalId: number) {
    const rows = await this.prisma.professionalReview.findMany({
      where: { professionalId, hiddenAt: null },
      orderBy: { createdAt: 'desc' },
      take: PUBLIC_REVIEWS,
      include: {
        customer: { select: { name: true } },
        barbershop: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      reviewerName: reviewerLabel(r.customer?.name),
      shopName: r.barbershop.name,
      reply: r.reply,
      repliedAt: r.repliedAt,
    }));
  }

  /** As avaliações que o profissional recebeu, em todas as unidades */
  async mine(userId: number) {
    const rows = await this.prisma.professionalReview.findMany({
      where: this.ownedBy(userId),
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        customer: { select: { name: true } },
        barbershop: { select: { name: true } },
        appointment: {
          select: {
            startAt: true,
            services: { select: { service: { select: { name: true } } } },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      reviewerName: reviewerLabel(r.customer?.name),
      shopName: r.barbershop.name,
      appointmentAt: r.appointment.startAt,
      serviceNames: r.appointment.services
        .map((s) => s.service?.name)
        .filter(Boolean)
        .join(', '),
      reply: r.reply,
      repliedAt: r.repliedAt,
      hidden: r.hiddenAt != null,
    }));
  }

  /** Resposta pública do profissional; vazio apaga */
  async reply(userId: number, reviewId: number, reply?: string | null) {
    const review = await this.prisma.professionalReview.findFirst({
      where: { id: reviewId, ...this.ownedBy(userId) },
      select: { id: true },
    });
    if (!review) throw new NotFoundException('Avaliação não encontrada');
    const text = reply?.trim() || null;
    if (text && text.length > MAX_REPLY) {
      throw new BadRequestException(`Resposta com no máximo ${MAX_REPLY} caracteres.`);
    }
    await this.prisma.professionalReview.update({
      where: { id: review.id },
      data: { reply: text, repliedAt: text ? new Date() : null },
    });
    return true;
  }

  /** Do profissional: pela conta (Professional) ou pelo cadastro dele na unidade */
  private ownedBy(userId: number) {
    return {
      OR: [{ professional: { is: { userId } } }, { barber: { is: { userId } } }],
    };
  }
}
