import { Args, Field, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { FeaturedPaymentService } from '../../barbershop/featured-payment.service';
import { BackofficeArea, RequireArea } from '../../auth/backoffice-areas';

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

@ObjectType()
export class AdminFeaturedPurchaseType {
  @Field(() => Int)
  id: number;

  @Field({ description: 'barbershop | professional' })
  ownerType: string;

  @Field()
  ownerName: string;

  @Field()
  buyerName: string;

  @Field(() => Int)
  amountCents: number;

  @Field(() => Int)
  days: number;

  @Field({ nullable: true })
  paidAt?: string;

  @Field({ nullable: true })
  featuredUntil?: string;
}

@ObjectType()
export class AdminFeaturedPurchasesType {
  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalCents: number;

  @Field(() => Int, { description: 'Últimos 30 dias' })
  last30Count: number;

  @Field(() => Int)
  last30Cents: number;

  @Field()
  currency: string;

  @Field(() => [AdminFeaturedPurchaseType])
  purchases: AdminFeaturedPurchaseType[];
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

  /** Backoffice: compras pagas de Destaque e a receita */
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.FINANCE)
  @Query(() => AdminFeaturedPurchasesType)
  adminFeaturedPurchases(@Args('limit', { type: () => Int, nullable: true }) limit?: number) {
    return this.featured.adminPurchases(limit ?? 100);
  }

  @Mutation(() => Boolean)
  confirmFeaturedPurchase(
    @CurrentUser() user: UserDTO,
    @Args('purchaseId', { type: () => Int }) purchaseId: number,
  ) {
    return this.featured.confirm(user.id, purchaseId);
  }
}
