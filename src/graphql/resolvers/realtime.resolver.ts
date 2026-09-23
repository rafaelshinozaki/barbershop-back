import { Context, Resolver, Subscription } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { BarbershopService } from '../../barbershop/barbershop.service';
import {
  NETWORK_ACTIVITY,
  NetworkActivityPayload,
  RealtimeService,
} from '../../realtime/realtime.service';
import { NetworkActivityEvent } from '../types/realtime.type';

type SubscriptionContext = { allowedBarbershopIds?: Set<number> };

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
}
