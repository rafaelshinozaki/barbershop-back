import { Args, Field, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { FeaturedPaymentService } from '../../barbershop/featured-payment.service';

@ObjectType()
export class FeaturedStatusType {
  @Field({
    description: 'Dá pra comprar agora (Stripe configurado e, no profissional, página pública)',
  })
  available: boolean;

  @Field({ description: 'Profissional sem página pública: precisa deixar pública antes' })
  needsPublicProfile: boolean;

  @Field(() => Int)
  priceCents: number;

  @Field()
  currency: string;

  @Field(() => Int)
  days: number;

  @Field({ nullable: true, description: 'ISO' })
  featuredUntil?: string;

  @Field()
  isFeatured: boolean;
}

@ObjectType()
export class FeaturedCheckoutType {
  @Field(() => Int)
  purchaseId: number;

  @Field()
  clientSecret: string;

  @Field(() => Int)
  priceCents: number;

  @Field()
  currency: string;

  @Field(() => Int)
  days: number;
}

/** Comprar 30 dias de Destaque na busca: unidade (dono/gerente) ou o próprio profissional */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
@UseGuards(GraphQLJwtAuthGuard)
export class FeaturedResolver {
  constructor(private readonly featured: FeaturedPaymentService) {}

  @Query(() => FeaturedStatusType)
  featuredStatus(
    @CurrentUser() user: UserDTO,
    @Args('ownerType', { description: 'barbershop | professional' }) ownerType: string,
    @Args('ownerId', { type: () => Int, nullable: true }) ownerId?: number,
  ) {
    return this.featured.status(user.id, ownerType, ownerId);
  }

  @Mutation(() => FeaturedCheckoutType)
  startFeaturedPurchase(
    @CurrentUser() user: UserDTO,
    @Args('ownerType') ownerType: string,
    @Args('ownerId', { type: () => Int, nullable: true }) ownerId?: number,
  ) {
    return this.featured.start(user.id, ownerType, ownerId);
  }

  @Mutation(() => Boolean)
  confirmFeaturedPurchase(
    @CurrentUser() user: UserDTO,
    @Args('purchaseId', { type: () => Int }) purchaseId: number,
  ) {
    return this.featured.confirm(user.id, purchaseId);
  }
}
