import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BarbershopService } from './barbershop.service';
import { stripeConfigured } from './stripe-configured';

/**
 * Preço provisório do Destaque: R$ 29,00 por 30 dias, igual para unidade e
 * profissional. Trocar aqui quando o produto fechar o número (como o Pro).
 */
export const FEATURED_PRICE_CENTS = 2900;
export const FEATURED_DAYS = 30;
export const FEATURED_CURRENCY = 'BRL';
const KIND = 'featured_purchase';

export type FeaturedOwnerType = 'barbershop' | 'professional';

/**
 * Comprar o "Destaque" na busca com cartão (receita da plataforma, sem
 * Connect): cada compra paga soma 30 dias ao fim do Destaque que já vale.
 * Unidade: dono e gerente compram. Profissional: o próprio, com a página
 * pública. O admin continua podendo ligar à mão no backoffice.
 */
@Injectable()
export class FeaturedPaymentService {
  private readonly logger = new Logger(FeaturedPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly barbershops: BarbershopService,
  ) {}

  /** Confere quem pode comprar e devolve o alvo (id, nome, Destaque atual) */
  private async target(userId: number, ownerType: string, ownerId?: number | null) {
    if (ownerType === 'barbershop') {
      if (ownerId == null) throw new BadRequestException('Informe a unidade');
      await this.barbershops.ensureAccess(userId, ownerId, 'manager');
      const shop = await this.prisma.barbershop.findUnique({
        where: { id: ownerId },
        select: { id: true, name: true, featuredUntil: true },
      });
      if (!shop) throw new NotFoundException('Unidade não encontrada');
      return { ownerType, ownerId: shop.id, name: shop.name, featuredUntil: shop.featuredUntil };
    }
    if (ownerType === 'professional') {
      const professional = await this.prisma.professional.findUnique({
        where: { userId },
        select: {
          id: true,
          slug: true,
          visibility: true,
          suspendedAt: true,
          featuredUntil: true,
          user: { select: { fullName: true } },
        },
      });
      if (!professional) throw new NotFoundException('Você ainda não tem perfil de profissional');
      if (ownerId != null && ownerId !== professional.id) {
        throw new ForbiddenException('Só o próprio profissional compra o Destaque dele');
      }
      return {
        ownerType,
        ownerId: professional.id,
        name: professional.user.fullName,
        featuredUntil: professional.featuredUntil,
        // A busca de profissionais só mostra quem tem a página pública
        publicProfile:
          !!professional.slug && professional.visibility === 'public' && !professional.suspendedAt,
      };
    }
    throw new BadRequestException('Tipo inválido');
  }

  async status(userId: number, ownerType: string, ownerId?: number | null) {
    const t = await this.target(userId, ownerType, ownerId);
    const now = new Date();
    const needsPublicProfile = 'publicProfile' in t && !t.publicProfile;
    return {
      available: stripeConfigured() && !needsPublicProfile,
      needsPublicProfile,
      priceCents: FEATURED_PRICE_CENTS,
      currency: FEATURED_CURRENCY,
      days: FEATURED_DAYS,
      featuredUntil: t.featuredUntil?.toISOString() ?? null,
      isFeatured: !!t.featuredUntil && t.featuredUntil > now,
    };
  }

  /** Começa (ou retoma) a compra: client secret pro cartão na tela */
  async start(userId: number, ownerType: string, ownerId?: number | null) {
    const t = await this.target(userId, ownerType, ownerId);
    if ('publicProfile' in t && !t.publicProfile) {
      throw new BadRequestException('Deixe sua página pública para aparecer na busca antes');
    }
    if (!stripeConfigured()) throw new BadRequestException('Pagamento online indisponível');

    // Compra em aberto da mesma pessoa para o mesmo alvo: reaproveita
    const pending = await this.prisma.featuredPurchase.findFirst({
      where: { ownerType: t.ownerType, ownerId: t.ownerId, userId, status: 'pending' },
      orderBy: { id: 'desc' },
    });
    if (pending?.stripePaymentIntentId) {
      const existing = await this.stripe.retrievePaymentIntent(pending.stripePaymentIntentId);
      if (existing.status === 'succeeded') {
        // Já pago (o aviso do Stripe ainda não tinha chegado): não cobra de novo
        await this.finalize(existing);
        throw new BadRequestException('A compra anterior acabou de ser confirmada');
      } else if (existing.status !== 'canceled' && existing.amount === FEATURED_PRICE_CENTS) {
        return this.startResult(pending.id, existing.client_secret!);
      } else {
        if (existing.status !== 'canceled') {
          await this.stripe.cancelPaymentIntent(existing.id).catch(() => undefined);
        }
        await this.prisma.featuredPurchase.update({
          where: { id: pending.id },
          data: { status: 'canceled' },
        });
      }
    }

    const purchase = await this.prisma.featuredPurchase.create({
      data: {
        ownerType: t.ownerType,
        ownerId: t.ownerId,
        userId,
        amountCents: FEATURED_PRICE_CENTS,
        currency: FEATURED_CURRENCY,
        days: FEATURED_DAYS,
      },
    });
    const intent = await this.stripe.createPaymentIntent(
      FEATURED_PRICE_CENTS,
      FEATURED_CURRENCY.toLowerCase(),
      undefined,
      {
        metadata: { kind: KIND, purchaseId: String(purchase.id) },
        description: `Destaque por ${FEATURED_DAYS} dias — ${t.name}`,
      },
    );
    await this.prisma.featuredPurchase.update({
      where: { id: purchase.id },
      data: { stripePaymentIntentId: intent.id },
    });
    return this.startResult(purchase.id, intent.client_secret!);
  }

  private startResult(purchaseId: number, clientSecret: string) {
    return {
      purchaseId,
      clientSecret,
      priceCents: FEATURED_PRICE_CENTS,
      currency: FEATURED_CURRENCY,
      days: FEATURED_DAYS,
    };
  }

  /** A tela voltou do cartão: confere no Stripe e registra */
  async confirm(userId: number, purchaseId: number) {
    const purchase = await this.prisma.featuredPurchase.findFirst({
      where: { id: purchaseId, userId },
    });
    if (!purchase) throw new NotFoundException('Compra não encontrada');
    if (purchase.status === 'paid') return true;
    if (!purchase.stripePaymentIntentId) throw new BadRequestException('Pagamento não iniciado');
    return this.finalize(await this.stripe.retrievePaymentIntent(purchase.stripePaymentIntentId));
  }

  /** Pagamento aprovado (tela ou webhook). Idempotente: cada compra soma os dias uma vez */
  async finalize(intent: Stripe.PaymentIntent): Promise<boolean> {
    if (intent.status !== 'succeeded') return false;
    const purchaseId = Number(intent.metadata?.purchaseId);
    const purchase = Number.isInteger(purchaseId)
      ? await this.prisma.featuredPurchase.findUnique({ where: { id: purchaseId } })
      : null;
    if (!purchase) {
      this.logger.warn(`Pagamento ${intent.id} sem compra de Destaque`);
      return false;
    }
    if (purchase.status === 'paid') return true;
    // O pagamento tem de ser desta compra e do valor dela
    if (
      intent.metadata?.kind !== KIND ||
      intent.amount < purchase.amountCents ||
      (purchase.stripePaymentIntentId && purchase.stripePaymentIntentId !== intent.id)
    ) {
      this.logger.warn(
        `Pagamento ${intent.id} não confere com a compra de Destaque #${purchase.id}`,
      );
      return false;
    }
    const claimed = await this.prisma.featuredPurchase.updateMany({
      where: { id: purchase.id, status: { not: 'paid' } },
      data: { status: 'paid', paidAt: new Date(), stripePaymentIntentId: intent.id },
    });
    if (claimed.count === 0) return true;

    // Soma os dias no banco, de uma vez: duas compras juntas não se atropelam
    const table = purchase.ownerType === 'barbershop' ? '"Barbershop"' : '"Professional"';
    const rows = await this.prisma.$queryRawUnsafe<{ featuredUntil: Date }[]>(
      `UPDATE ${table}
          SET "featuredUntil" = GREATEST(COALESCE("featuredUntil", NOW()), NOW()) + ($1 || ' days')::interval
        WHERE id = $2
        RETURNING "featuredUntil"`,
      String(purchase.days),
      purchase.ownerId,
    );
    await this.prisma.featuredPurchase.update({
      where: { id: purchase.id },
      data: { featuredUntil: rows[0]?.featuredUntil ?? null },
    });
    return true;
  }
}
