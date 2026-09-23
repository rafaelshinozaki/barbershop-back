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
import {
  NetworkActivityEvent,
  NotificationEvent,
  PublicSlotsChangedEvent,
} from '../types/realtime.type';

type SubscriptionContext = { allowedBarbershopIds?: Set<number>; userId?: number };

@Resolver()
export class RealtimeResolver {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly barbershopService: BarbershopService,
  ) {}

  /**
   * Eventos das barbearias que o usuário acessa (dono, dono da rede ou
   * equipe — mesma regra de myBarbershops). A lista é calculada ao assinar;
   * uma barbearia nova passa a valer na próxima conexão.
   */
  @UseGuards(GraphQLJwtAuthGuard)
  @Subscription(() => NetworkActivityEvent, {
    filter: (
      payload: { networkActivity: NetworkActivityPayload },
      _variables: unknown,
      context: SubscriptionContext,
    ) => !!context.allowedBarbershopIds?.has(payload.networkActivity.barbershopId),
  })
  async networkActivity(@CurrentUser() user: UserDTO, @Context() context: SubscriptionContext) {
    const shops = await this.barbershopService.getMyBarbershops(user.id);
    context.allowedBarbershopIds = new Set(shops.map((b) => b.id));
    return this.realtime.pubSub.asyncIterator(NETWORK_ACTIVITY);
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
