import { Args, Context, Field, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { GraphQLClientJwtAuthGuard } from '../../client-auth/guards/graphql-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '../../client-auth/current-client.decorator';
import { PushService } from '../../push/push.service';

// Inscrever/desinscrever: 20 por hora por IP/navegador
const ThrottlePush = () => Throttle({ default: { limit: 20, ttl: 3600000 } });

@InputType()
export class PushSubscriptionInput {
  @Field()
  endpoint: string;

  @Field()
  p256dh: string;

  @Field()
  auth: string;

  @Field({ nullable: true, description: 'Idioma do aparelho (pt/en/es) pro texto da notificação' })
  language?: string;
}

/**
 * Notificação no celular/navegador (Web Push): a chave pública VAPID
 * (null = não configurado, o front não oferece) e a inscrição de cada
 * aparelho, da equipe ou da área do cliente.
 */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class PushResolver {
  constructor(private readonly push: PushService) {}

  @Query(() => String, { nullable: true })
  pushPublicKey() {
    return this.push.publicKey();
  }

  @ThrottlePush()
  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  savePushSubscription(
    @Args('input') input: PushSubscriptionInput,
    @CurrentUser() user: UserDTO,
    @Context() context: any,
  ) {
    return this.push.subscribe({ userId: user.id }, input, {
      userAgent: context.req?.headers?.['user-agent'],
      language: input.language,
    });
  }

  @ThrottlePush()
  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => Boolean)
  clientSavePushSubscription(
    @Args('input') input: PushSubscriptionInput,
    @CurrentClient() client: CurrentClientUser,
    @Context() context: any,
  ) {
    return this.push.subscribe({ clientAccountId: client.id }, input, {
      userAgent: context.req?.headers?.['user-agent'],
      language: input.language,
    });
  }

  /** Desligar neste aparelho (ou ao sair da conta) */
  @ThrottlePush()
  @Mutation(() => Boolean)
  removePushSubscription(@Args('endpoint') endpoint: string) {
    return this.push.unsubscribe(endpoint);
  }
}
