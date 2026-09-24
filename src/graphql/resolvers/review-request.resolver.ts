import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ReviewRequestService } from '../../barbershop/review-request.service';

/** Equipe: link "como foi?" de um atendimento pra mandar ao cliente */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class ReviewRequestResolver {
  constructor(private readonly reviewRequests: ReviewRequestService) {}

  @Query(() => String)
  async appointmentReviewLink(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.reviewRequests.staffReviewLink(user.id, barbershopId, appointmentId);
  }
}
