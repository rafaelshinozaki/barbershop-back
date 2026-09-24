import { Args, Field, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ReviewRequestService } from '../../barbershop/review-request.service';
import { ReviewManagementService } from '../../barbershop/review-management.service';

/** Avaliação vista pela unidade (e pela moderação da plataforma) */
@ObjectType()
export class ManagedReviewType {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  rating: number;

  @Field({ nullable: true })
  comment?: string | null;

  @Field()
  createdAt: Date;

  @Field()
  reviewerName: string;

  @Field({ nullable: true })
  reply?: string | null;

  @Field({ nullable: true })
  repliedAt?: Date | null;

  @Field({ nullable: true, description: 'Denunciada (aguardando moderação)' })
  reportedAt?: Date | null;

  @Field({ nullable: true })
  reportReason?: string | null;

  @Field({ description: 'Ocultada pela moderação (fora da página e da nota)' })
  hidden: boolean;

  @Field({ nullable: true })
  barbershopName?: string;

  @Field({ nullable: true })
  barbershopSlug?: string;
}

/** Avaliações: pedir (link), responder, denunciar e moderar */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class ReviewRequestResolver {
  constructor(
    private readonly reviewRequests: ReviewRequestService,
    private readonly reviews: ReviewManagementService,
  ) {}

  /** Equipe: link "como foi?" de um atendimento pra mandar ao cliente */
  @Query(() => String)
  async appointmentReviewLink(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.reviewRequests.staffReviewLink(user.id, barbershopId, appointmentId);
  }

  /** Dono e gerente: todas as avaliações da unidade */
  @Query(() => [ManagedReviewType])
  async managedReviews(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.reviews.listForShop(user.id, barbershopId);
  }

  /** Resposta pública da unidade; vazio apaga */
  @Mutation(() => Boolean)
  async replyToReview(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('reviewId', { type: () => Int }) reviewId: number,
    @CurrentUser() user: UserDTO,
    @Args('reply', { nullable: true }) reply?: string,
  ) {
    return this.reviews.reply(user.id, barbershopId, reviewId, reply);
  }

  @Mutation(() => Boolean)
  async reportReview(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('reviewId', { type: () => Int }) reviewId: number,
    @Args('reason') reason: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.reviews.report(user.id, barbershopId, reviewId, reason);
  }

  // ---- moderação (admin da plataforma) ----

  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @Query(() => [ManagedReviewType])
  async reportedReviews() {
    return this.reviews.listForModeration();
  }

  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @Mutation(() => Boolean)
  async moderateReview(
    @Args('reviewId', { type: () => Int }) reviewId: number,
    @Args('hide') hide: boolean,
  ) {
    return this.reviews.moderate(reviewId, hide);
  }
}
