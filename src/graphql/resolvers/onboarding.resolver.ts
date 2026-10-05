import { Args, Field, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { OnboardingService } from '../../onboarding/onboarding.service';

@ObjectType()
export class OnboardingStepType {
  /** services | hours | team | publicPage | payments | firstAppointment | agenda | … */
  @Field()
  id: string;

  @Field()
  done: boolean;

  /** Não conta para "tudo feito" (ex.: receber pelo app) */
  @Field()
  optional: boolean;
}

@ObjectType()
export class OnboardingType {
  @Field(() => Int, { nullable: true })
  barbershopId?: number | null;

  @Field(() => String, { nullable: true })
  barbershopName?: string | null;

  /** newOwner | owner | manager | reception | barber | basic */
  @Field()
  role: string;

  @Field(() => [OnboardingStepType])
  steps: OnboardingStepType[];
}

/** Boas-vindas por cargo (tela inicial) */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class OnboardingResolver {
  constructor(private readonly onboarding: OnboardingService) {}

  /** O card a mostrar agora (null = nenhum) */
  @Query(() => OnboardingType, { nullable: true })
  myOnboarding(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int, nullable: true }) barbershopId?: number,
  ) {
    return this.onboarding.forUser(user.id, barbershopId);
  }

  @Mutation(() => Boolean)
  completeOnboardingStep(
    @CurrentUser() user: UserDTO,
    @Args('step') step: string,
    @Args('barbershopId', { type: () => Int, nullable: true }) barbershopId?: number,
  ) {
    return this.onboarding.markStep(user.id, barbershopId ?? null, step);
  }

  @Mutation(() => Boolean)
  dismissOnboarding(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int, nullable: true }) barbershopId?: number,
  ) {
    return this.onboarding.dismiss(user.id, barbershopId ?? null);
  }
}
