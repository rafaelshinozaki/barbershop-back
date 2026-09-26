import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { SoloService } from '../../barbershop/solo.service';
import { SoloPracticeType } from '../types/solo.type';
import { StartSoloPracticeInput } from '../dto/solo.dto';

/** Agenda por conta própria da pessoa logada, com a cota do mês. */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class SoloResolver {
  constructor(private readonly solo: SoloService) {}

  @Query(() => SoloPracticeType)
  mySoloPractice(@CurrentUser() user: UserDTO) {
    return this.solo.status(user.id);
  }

  @Mutation(() => SoloPracticeType)
  startSoloPractice(
    @Args('input') input: StartSoloPracticeInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.solo.start(user.id, input);
  }
}
