import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { SoloService } from '../../barbershop/solo.service';
import { ProReferralService } from '../../barbershop/pro-referral.service';
import { ProReferralType, SoloPracticeType } from '../types/solo.type';
import { StartSoloPracticeInput } from '../dto/solo.dto';

/** Agenda por conta própria da pessoa logada, com a cota do mês e a indicação do Pro. */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class SoloResolver {
  constructor(
    private readonly solo: SoloService,
    private readonly referrals: ProReferralService,
  ) {}

  @Query(() => ProReferralType)
  myProReferral(@CurrentUser() user: UserDTO) {
    return this.referrals.status(user.id);
  }

  @Mutation(() => ProReferralType)
  claimProReferral(@Args('code') code: string, @CurrentUser() user: UserDTO) {
    return this.referrals.claim(user.id, code);
  }

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
