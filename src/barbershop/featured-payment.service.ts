import { must } from '../common/must';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PushService } from '../push/push.service';
import { NotificationType } from '../notifications/dto/create-notification.dto';
import { FEATURED_QUEUE } from '../queue/queue.constants';
import { registerSchedulers } from '../queue/register-schedulers';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BarbershopService } from './barbershop.service';
import { SearchCacheService } from './search-cache.service';
import { stripeConfigured } from './stripe-configured';
import { PLATFORM_CURRENCY, currentPricing } from '../pricing/pricing';

/**
 * Preço e dias do Destaque: vêm de "Preços e taxas" (src/pricing/pricing.ts),
 * um para a unidade e outro para o profissional. O admin muda sem deploy.
 */
export function featuredOffer(ownerType: string) {
  const p = currentPricing();
  return {
    priceCents: ownerType === 'barbershop' ? p.featuredShopPriceCents : p.featuredProPriceCents,
    days: p.featuredDays,
  };
}
export const FEATURED_CURRENCY = PLATFORM_CURRENCY;
/** Quantos dias antes de vencer o aviso sai */
export const FEATURED_REMIND_DAYS = 3;
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
    @Optional() private readonly push?: PushService,
    @Optional() private readonly searchCache?: SearchCacheService,
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
    const offer = featuredOffer(t.ownerType);
    return {
      available: stripeConfigured() && !needsPublicProfile,
      needsPublicProfile,
      priceCents: offer.priceCents,
      currency: FEATURED_CURRENCY,
      days: offer.days,
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
    const offer = featuredOffer(t.ownerType);

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
      } else if (
        existing.status !== 'canceled' &&
        existing.amount === offer.priceCents &&
        pending.days === offer.days
      ) {
        // Mesmo preço e dias de agora: retoma; se o admin mudou, começa outra
        return this.startResult(pending, must(existing.client_secret, 'client_secret'));
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
        amountCents: offer.priceCents,
        currency: FEATURED_CURRENCY,
        days: offer.days,
      },
    });
    const intent = await this.stripe.createPaymentIntent(
      offer.priceCents,
      FEATURED_CURRENCY.toLowerCase(),
      undefined,
      {
        metadata: { kind: KIND, purchaseId: String(purchase.id) },
        description: `Destaque por ${offer.days} dias — ${t.name}`,
      },
    );
    await this.prisma.featuredPurchase.update({
      where: { id: purchase.id },
      data: { stripePaymentIntentId: intent.id },
    });
    return this.startResult(purchase, must(intent.client_secret, 'client_secret'));
  }

  private startResult(
    purchase: { id: number; amountCents: number; currency: string; days: number },
    clientSecret: string,
  ) {
    return {
      purchaseId: purchase.id,
      clientSecret,
      priceCents: purchase.amountCents,
      currency: purchase.currency,
      days: purchase.days,
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
    // Comprou o Destaque: aparece no topo da busca na hora
    await this.searchCache?.bump();
    return true;
  }

  /**
   * Avisa (sininho e celular) quem tem o Destaque vencendo nos próximos
   * dias, uma vez por vencimento: comprar mais dias muda a data e o aviso
   * do novo vencimento sai de novo. Roda de hora em hora.
   */
  async remindExpiring(now = new Date()) {
    const limit = new Date(now.getTime() + FEATURED_REMIND_DAYS * 86_400_000);
    const window = { gt: now, lte: limit };
    const pending = (until: Date, reminded: Date | null) =>
      !reminded || reminded.getTime() !== until.getTime();
    let sent = 0;

    const shops = await this.prisma.barbershop.findMany({
      where: { featuredUntil: window, isActive: true },
      select: {
        id: true,
        name: true,
        featuredUntil: true,
        featuredRemindedUntil: true,
        ownerUserId: true,
        network: { select: { ownerUserId: true } },
        barbers: {
          where: { isActive: true, staffType: 'manager', userId: { not: null } },
          select: { userId: true },
        },
      },
    });
    for (const shop of shops) {
      const until = shop.featuredUntil;
      if (!until || !pending(until, shop.featuredRemindedUntil)) continue;
      const claimed = await this.prisma.barbershop.updateMany({
        where: { id: shop.id, featuredUntil: until },
        data: { featuredRemindedUntil: until },
      });
      if (claimed.count === 0) continue;
      const users = [
        shop.ownerUserId,
        shop.network?.ownerUserId,
        ...shop.barbers.map((b) => b.userId),
      ].filter((u): u is number => typeof u === 'number');
      await this.notifyExpiring(users, shop.name, until, `/barbershops/${shop.id}/public-page`);
      sent++;
    }

    const pros = await this.prisma.professional.findMany({
      where: { featuredUntil: window },
      select: { id: true, userId: true, featuredUntil: true, featuredRemindedUntil: true },
    });
    for (const pro of pros) {
      const until = pro.featuredUntil;
      if (!until || !pending(until, pro.featuredRemindedUntil)) continue;
      const claimed = await this.prisma.professional.updateMany({
        where: { id: pro.id, featuredUntil: until },
        data: { featuredRemindedUntil: until },
      });
      if (claimed.count === 0) continue;
      await this.notifyExpiring([pro.userId], null, until, '/profile-privacy');
      sent++;
    }
    return sent;
  }

  private async notifyExpiring(
    userIds: number[],
    shopName: string | null,
    until: Date,
    actionUrl: string,
  ) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    const date = until.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const title = 'Destaque vence em breve';
    const message = shopName
      ? `O Destaque de ${shopName} na busca vence em ${date}. Estenda para continuar no topo.`
      : `Seu Destaque na busca vence em ${date}. Estenda para continuar no topo.`;
    try {
      await this.prisma.userNotification.createMany({
        data: ids.map((userId) => ({
          userId,
          title,
          message,
          type: NotificationType.INFO,
          actionUrl,
        })),
      });
      await this.push?.sendToUsers(ids, () => ({
        title,
        body: message,
        url: actionUrl,
        tag: 'featured',
      }));
    } catch (err) {
      this.logger.warn(`Aviso de Destaque vencendo não enviado: ${err}`);
    }
  }

  /** Backoffice: compras pagas (as mais recentes) e os totais */
  async adminPurchases(limit = 100) {
    const [rows, all, last30] = await Promise.all([
      this.prisma.featuredPurchase.findMany({
        where: { status: 'paid' },
        orderBy: { paidAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 200),
      }),
      this.prisma.featuredPurchase.aggregate({
        where: { status: 'paid' },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.featuredPurchase.aggregate({
        where: { status: 'paid', paidAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
    ]);
    const shopIds = rows.filter((r) => r.ownerType === 'barbershop').map((r) => r.ownerId);
    const proIds = rows.filter((r) => r.ownerType === 'professional').map((r) => r.ownerId);
    const [shops, pros, buyers] = await Promise.all([
      this.prisma.barbershop.findMany({
        where: { id: { in: shopIds } },
        select: { id: true, name: true },
      }),
      this.prisma.professional.findMany({
        where: { id: { in: proIds } },
        select: { id: true, user: { select: { fullName: true } } },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, fullName: true },
      }),
    ]);
    const shopName = new Map(shops.map((s) => [s.id, s.name]));
    const proName = new Map(pros.map((p) => [p.id, p.user.fullName]));
    const buyerName = new Map(buyers.map((u) => [u.id, u.fullName]));
    return {
      totalCount: all._count._all,
      totalCents: all._sum.amountCents ?? 0,
      last30Count: last30._count._all,
      last30Cents: last30._sum.amountCents ?? 0,
      currency: FEATURED_CURRENCY,
      purchases: rows.map((r) => ({
        id: r.id,
        ownerType: r.ownerType,
        ownerName:
          (r.ownerType === 'barbershop' ? shopName.get(r.ownerId) : proName.get(r.ownerId)) ?? '—',
        buyerName: buyerName.get(r.userId) ?? '—',
        amountCents: r.amountCents,
        days: r.days,
        paidAt: r.paidAt?.toISOString() ?? null,
        featuredUntil: r.featuredUntil?.toISOString() ?? null,
      })),
    };
  }
}

/** Aviso de Destaque vencendo: uma execução por hora, uma só no cluster */
@Injectable()
export class FeaturedScheduler implements OnModuleInit {
  constructor(@InjectQueue(FEATURED_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    registerSchedulers(this.queue, [
      { id: 'remind-expiring-featured', repeat: { every: 60 * 60 * 1000 } },
    ]);
  }
}

@Processor(FEATURED_QUEUE)
export class FeaturedProcessor extends WorkerHost {
  constructor(private readonly featured: FeaturedPaymentService) {
    super();
  }

  async process() {
    return this.featured.remindExpiring();
  }
}
