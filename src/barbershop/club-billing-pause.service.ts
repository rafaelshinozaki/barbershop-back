import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { StripeService } from '@/stripe/stripe.service';
import { supportEmail } from '../common/app-urls';

/** Motivo gravado na assinatura. O do dono desativado leva o id da conta. */
export type ClubPauseReason = 'platform_shop' | 'platform_network' | 'owner_inactive';

const REASON_TOKEN: Record<Exclude<ClubPauseReason, 'owner_inactive'>, string> = {
  platform_shop: 'platform_shop',
  platform_network: 'platform_network',
};

const SUBJECTS = {
  paused: {
    pt: 'A cobrança do clube foi pausada',
    en: 'Club billing is paused',
    es: 'El cobro del club está en pausa',
  },
  resumed: {
    pt: 'A cobrança do clube voltou',
    en: 'Club billing is back',
    es: 'El cobro del club volvió',
  },
};

type SubRow = {
  id: number;
  stripeSubscriptionId: string;
  shopPausedAt: Date | null;
  billingPauseReasons: string[];
  clientAccount: { email: string; name: string; language: string | null; deletedAt: Date | null };
  plan: { name: string };
  barbershop: { name: string };
};

/**
 * Pausa a cobrança do clube na Stripe quando a unidade sai do ar por fora
 * da pausa do dono: suspensão da unidade, da rede, ou conta do dono
 * desativada. Cada motivo fica marcado. A Stripe só volta quando não sobra
 * nenhum, inclusive a pausa do dono (shopPausedAt).
 */
@Injectable()
export class ClubBillingPauseService {
  private readonly logger = new Logger(ClubBillingPauseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly email: EmailService,
  ) {}

  /** Suspensão da unidade pela plataforma. */
  forShop(barbershopId: number, paused: boolean) {
    return this.apply('platform_shop', [barbershopId], paused);
  }

  /** Suspensão da rede: todas as unidades dela. */
  async forNetwork(networkId: number, paused: boolean) {
    const shops = await this.prisma.barbershop.findMany({
      where: { networkId },
      select: { id: true },
    });
    await this.apply(
      'platform_network',
      shops.map((shop) => shop.id),
      paused,
    );
  }

  /**
   * Conta desativada: as unidades desse dono e as da rede que ele é dono.
   * As duas podem ser pessoas diferentes; cada uma segura a pausa com o
   * próprio id.
   */
  async forOwner(userId: number, paused: boolean) {
    const shops = await this.prisma.barbershop.findMany({
      where: { OR: [{ ownerUserId: userId }, { network: { ownerUserId: userId } }] },
      select: { id: true },
    });
    await this.apply(
      'owner_inactive',
      shops.map((shop) => shop.id),
      paused,
      userId,
    );
  }

  private token(reason: ClubPauseReason, userId?: number) {
    if (reason === 'owner_inactive') return `owner_inactive:${userId}`;
    return REASON_TOKEN[reason];
  }

  private async apply(
    reason: ClubPauseReason,
    barbershopIds: number[],
    paused: boolean,
    userId?: number,
  ) {
    const ids = [...new Set(barbershopIds)];
    if (!ids.length) return;
    const token = this.token(reason, userId);
    const subs = (await this.prisma.clientSubscription.findMany({
      where: paused
        ? {
            barbershopId: { in: ids },
            status: { in: ['ACTIVE', 'PAST_DUE'] },
            NOT: { billingPauseReasons: { has: token } },
          }
        : { barbershopId: { in: ids }, billingPauseReasons: { has: token } },
      select: {
        id: true,
        stripeSubscriptionId: true,
        shopPausedAt: true,
        billingPauseReasons: true,
        clientAccount: { select: { email: true, name: true, language: true, deletedAt: true } },
        plan: { select: { name: true } },
        barbershop: { select: { name: true } },
      },
    })) as SubRow[];

    let failed = false;
    for (const sub of subs) {
      const remaining = sub.billingPauseReasons.filter((item) => item !== token);
      const heldBySomeoneElse =
        sub.shopPausedAt != null ||
        (paused ? sub.billingPauseReasons.length > 0 : remaining.length > 0);
      try {
        if (!heldBySomeoneElse) {
          await this.stripe.updateSubscription(sub.stripeSubscriptionId, {
            pause_collection: paused ? { behavior: 'void' } : ('' as never),
          });
        }
      } catch (err) {
        failed = true;
        this.logger.error(
          `Clube ${sub.id}: cobrança não foi ${paused ? 'pausada' : 'retomada'} na Stripe`,
          err as Error,
        );
        continue;
      }
      await this.prisma.clientSubscription.update({
        where: { id: sub.id },
        data: paused
          ? { billingPauseReasons: { push: token } }
          : { billingPauseReasons: { set: remaining } },
      });
      if (!heldBySomeoneElse) await this.emailSubscriber(sub, paused, reason);
    }
    if (failed) throw new Error('Não foi possível atualizar a cobrança do clube');
  }

  private async emailSubscriber(sub: SubRow, paused: boolean, reason: ClubPauseReason) {
    const account = sub.clientAccount;
    if (!account.email || account.deletedAt) return;
    await this.email
      .sendCustomerEmail(
        null,
        'club_billing_paused',
        {
          FullName: account.name.split(' ')[0] || account.name,
          ShopName: sub.barbershop.name,
          PlanName: sub.plan.name,
          Paused: paused,
          Resumed: !paused,
          OwnerInactive: reason === 'owner_inactive',
          AppName: 'Barbershop',
          SupportEmail: supportEmail(),
          Year: new Date().getFullYear(),
        },
        paused ? SUBJECTS.paused : SUBJECTS.resumed,
        'club-billing-paused',
        account.email,
        account.language ?? 'pt',
      )
      .catch((err: unknown) =>
        this.logger.warn(`Aviso do clube não enviado (assinatura ${sub.id}): ${err}`),
      );
  }
}
