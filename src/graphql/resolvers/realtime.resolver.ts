import { Args, Context, Int, Resolver, Subscription } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { BarbershopService } from '../../barbershop/barbershop.service';
import {
  NETWORK_ACTIVITY,
  PUBLIC_SLOTS,
  NetworkActivityPayload,
  RealtimeService,
  USER_NOTIFICATIONS,
  UserNotificationsPayload,
} from '../../realtime/realtime.service';
import { shopAccessStale } from '../../realtime/shop-access-cache';
import {
  NetworkActivityEvent,
  NotificationEvent,
  PublicSlotsChangedEvent,
} from '../types/realtime.type';

type SubscriptionContext = {
  allowedBarbershopIds?: Set<number>;
  allowedBarbershopIdsAt?: number;
  userId?: number;
};

@Resolver()
export class RealtimeResolver {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly barbershopService: BarbershopService,
  ) {}

  /**
   * Eventos das barbearias que o usuário acessa (dono, dono da rede ou
   * equipe — mesma regra de myBarbershops). A lista é relida a cada aviso,
   * com cache curto: quem sai da equipe para de receber, e quem entra passa
   * a receber, sem esperar a página recarregar.
   */
  @UseGuards(GraphQLJwtAuthGuard)
  @Subscription(() => NetworkActivityEvent, {
    filter(
      this: RealtimeResolver,
      payload: { networkActivity: NetworkActivityPayload },
      _variables: unknown,
      context: SubscriptionContext,
    ) {
      return this.allowsShop(context, payload.networkActivity.barbershopId);
    },
  })
  async networkActivity(@CurrentUser() user: UserDTO, @Context() context: SubscriptionContext) {
    context.userId = user.id;
    await this.refreshShopAccess(context);
    return this.realtime.pubSub.asyncIterator(NETWORK_ACTIVITY);
  }

  private async allowsShop(context: SubscriptionContext, barbershopId: number) {
    if (shopAccessStale(context.allowedBarbershopIdsAt, Date.now())) {
      await this.refreshShopAccess(context);
    }
    return context.allowedBarbershopIds?.has(barbershopId) ?? false;
  }

  private async refreshShopAccess(context: SubscriptionContext) {
    if (context.userId == null) {
      context.allowedBarbershopIds = new Set();
      context.allowedBarbershopIdsAt = Date.now();
      return;
    }
    const shops = await this.barbershopService.getMyBarbershops(context.userId);
    context.allowedBarbershopIds = new Set(shops.map((b) => b.id));
    context.allowedBarbershopIdsAt = Date.now();
  }

  /** Sininho em tempo real: só os avisos das notificações do próprio usuário. */
  @UseGuards(GraphQLJwtAuthGuard)
  @Subscription(() => NotificationEvent, {
    filter: (
      payload: { myNotificationEvents: UserNotificationsPayload },
      _variables: unknown,
      context: SubscriptionContext,
    ) => context.userId != null && payload.myNotificationEvents.userIds.includes(context.userId),
  })
  myNotificationEvents(@CurrentUser() user: UserDTO, @Context() context: SubscriptionContext) {
    context.userId = user.id;
    return this.realtime.pubSub.asyncIterator(USER_NOTIFICATIONS);
  }

  /**
   * Página pública (sem login): avisa quem está escolhendo horário numa
   * barbearia que a agenda dela mudou, pra não oferecer horário já tomado.
   * O aviso não traz nenhum dado do agendamento.
   */
  @Subscription(() => PublicSlotsChangedEvent, {
    filter: (
      payload: { publicSlotsChanged: { barbershopId: number } },
      variables: { barbershopId: number },
    ) => payload.publicSlotsChanged.barbershopId === variables.barbershopId,
  })
  publicSlotsChanged(@Args('barbershopId', { type: () => Int }) _barbershopId: number) {
    return this.realtime.pubSub.asyncIterator(PUBLIC_SLOTS);
  }
}
