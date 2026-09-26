import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { CareerService } from '../../barbershop/career.service';
import { CareerOverviewType } from '../types/career.type';

/** Panorama da carreira da pessoa logada, em todas as unidades. */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class CareerResolver {
  constructor(private readonly career: CareerService) {}

  @Query(() => CareerOverviewType)
  myCareer(@CurrentUser() user: UserDTO) {
    return this.career.overview(user.id);
  }

  @Mutation(() => CareerOverviewType)
  setMyCareerPublic(
    @Args('isPublic', { type: () => Boolean }) isPublic: boolean,
    @CurrentUser() user: UserDTO,
  ) {
    return this.career.setPublic(user.id, isPublic);
  }
}
