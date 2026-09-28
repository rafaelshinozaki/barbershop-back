import {
  Args,
  Field,
  Float,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { PricingService } from '../../pricing/pricing.service';

@ObjectType()
export class PricingValuesType {
  @Field(() => Float, { description: '% da plataforma sobre o que passa pelo Stripe' })
  platformFeePercent: number;

  @Field(() => Int, { description: 'Pro por mês, em centavos' })
  proPriceCents: number;

  @Field(() => Int, { description: 'Destaque da unidade por período, em centavos' })
  featuredShopPriceCents: number;

  @Field(() => Int, { description: 'Destaque do profissional por período, em centavos' })
  featuredProPriceCents: number;

  @Field(() => Int, { description: 'Dias de Destaque por compra' })
  featuredDays: number;

  @Field(() => Int, { description: 'Taxa por vaga preenchida, em centavos (0 = grátis)' })
  jobFillFeeCents: number;
}

@ObjectType()
export class PricingType extends PricingValuesType {
  @Field(() => PricingValuesType, { description: 'Valores padrão (genéricos) do código' })
  defaults: PricingValuesType;
}

@InputType()
export class UpdatePricingInput {
  @Field(() => Float, { nullable: true })
  platformFeePercent?: number;

  @Field(() => Int, { nullable: true })
  proPriceCents?: number;

  @Field(() => Int, { nullable: true })
  featuredShopPriceCents?: number;

  @Field(() => Int, { nullable: true })
  featuredProPriceCents?: number;

  @Field(() => Int, { nullable: true })
  featuredDays?: number;

  @Field(() => Int, { nullable: true })
  jobFillFeeCents?: number;
}

/** Preços e taxas da plataforma: todos veem (as telas mostram); só o admin muda */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class PricingResolver {
  constructor(private readonly pricing: PricingService) {}

  @Query(() => PricingType)
  platformPricing() {
    return this.pricing.get();
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => PricingType)
  updatePlatformPricing(@CurrentUser() user: UserDTO, @Args('input') input: UpdatePricingInput) {
    return this.pricing.update(user.id, input);
  }
}
