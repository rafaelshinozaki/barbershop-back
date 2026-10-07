import { Args, Field, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { OnboardingService } from '../../onboarding/onboarding.service';
import { GraphQLClientJwtAuthGuard } from '../../client-auth/guards/graphql-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '../../client-auth/current-client.decorator';

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

  /** O sistema confere pelos dados; os outros contam ao abrir a tela (completeOnboardingStep) */
  @Field()
  auto: boolean;
}

@ObjectType()
export class OnboardingType {
  @Field(() => Int, { nullable: true })
  barbershopId?: number | null;

  @Field(() => String, { nullable: true })
  barbershopName?: string | null;

  /** newOwner | owner | manager | reception | barber | basic | solo | professional | client */
  @Field()
  role: string;

  @Field(() => [OnboardingStepType])
  steps: OnboardingStepType[];
}

/** Boas-vindas por cargo (tela inicial) e do cliente final (área do cliente) */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class OnboardingResolver {
  constructor(private readonly onboarding: OnboardingService) {}

  /** O card a mostrar agora (null = nenhum) */
  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => OnboardingType, { nullable: true })
  myOnboarding(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int, nullable: true }) barbershopId?: number,
  ) {
    return this.onboarding.forUser(user.id, barbershopId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  completeOnboardingStep(
    @CurrentUser() user: UserDTO,
    @Args('step') step: string,
    @Args('barbershopId', { type: () => Int, nullable: true }) barbershopId?: number,
  ) {
    return this.onboarding.markStep(user.id, barbershopId ?? null, step);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  dismissOnboarding(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int, nullable: true }) barbershopId?: number,
  ) {
    return this.onboarding.dismiss(user.id, barbershopId ?? null);
  }

  /** Boas-vindas da área do cliente (null = nenhum) */
  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => OnboardingType, { nullable: true })
  myClientOnboarding(@CurrentClient() client: CurrentClientUser) {
    return this.onboarding.forClient(client.id);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => Boolean)
  dismissClientOnboarding(@CurrentClient() client: CurrentClientUser) {
    return this.onboarding.dismissClient(client.id);
  }
}
