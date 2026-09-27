import { Args, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { CareerService } from '../../barbershop/career.service';
import { S3Service } from '../../aws/s3.service';
import { PublicProfessionalType } from '../types/career.type';
import { GraphQLJwtAuthGuard, OptionalAuth } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';

/** /p/:slug. Público para qualquer um; "só na plataforma" exige conta de equipe. Oculto não existe. */
@Resolver(() => PublicProfessionalType)
@UseFilters(GqlHttpExceptionFilter)
export class PublicProfessionalResolver {
  constructor(private readonly career: CareerService, private readonly s3: S3Service) {}

  @Query(() => PublicProfessionalType)
  @OptionalAuth()
  @UseGuards(GraphQLJwtAuthGuard)
  publicProfessional(@Args('slug') slug: string, @CurrentUser() user?: UserDTO) {
    return this.career.publicProfile(slug, user?.id);
  }

  @ResolveField(() => String, { nullable: true })
  photoUrl(@Parent() profile: { photoKey?: string | null }) {
    if (!profile.photoKey) return null;
    return this.s3.getDownloadUrl(profile.photoKey).catch(() => null);
  }
}
