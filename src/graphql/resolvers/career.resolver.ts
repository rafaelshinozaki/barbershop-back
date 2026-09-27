import { Args, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { CareerService } from '../../barbershop/career.service';
import { S3Service } from '../../aws/s3.service';
import {
  CareerOverviewType,
  MyProfessionalReviewType,
  ProfilePrivacyType,
} from '../types/career.type';
import { ProfessionalReviewService } from '../../barbershop/professional-review.service';
import { ProfessionalSignupInput, UpdateProfilePrivacyInput } from '../dto/auth.dto';

/** Panorama da carreira da pessoa logada, em todas as unidades. */
@Resolver(() => ProfilePrivacyType)
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class CareerResolver {
  constructor(
    private readonly career: CareerService,
    private readonly s3: S3Service,
    private readonly professionalReviews: ProfessionalReviewService,
  ) {}

  /** Avaliações que a pessoa recebeu como profissional, em todas as unidades */
  @Query(() => [MyProfessionalReviewType])
  myProfessionalReviews(@CurrentUser() user: UserDTO) {
    return this.professionalReviews.mine(user.id);
  }

  /** Resposta pública do profissional a uma avaliação; vazio apaga */
  @Mutation(() => Boolean)
  replyToProfessionalReview(
    @Args('reviewId', { type: () => Int }) reviewId: number,
    @CurrentUser() user: UserDTO,
    @Args('reply', { nullable: true }) reply?: string,
  ) {
    return this.professionalReviews.reply(user.id, reviewId, reply);
  }

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

  @Query(() => ProfilePrivacyType)
  myProfilePrivacy(@CurrentUser() user: UserDTO) {
    return this.career.privacy(user.id);
  }

  @Mutation(() => ProfilePrivacyType)
  enableMyProfessionalProfile(
    @Args('input') input: ProfessionalSignupInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.career.enableProfile(user.id, input);
  }

  @Mutation(() => ProfilePrivacyType)
  updateMyProfilePrivacy(
    @Args('input') input: UpdateProfilePrivacyInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.career.updatePrivacy(user.id, input);
  }

  @ResolveField(() => String, { nullable: true })
  photoUrl(@Parent() profile: { photoKey?: string | null }) {
    if (!profile.photoKey) return null;
    return this.s3.getDownloadUrl(profile.photoKey).catch(() => null);
  }
}
