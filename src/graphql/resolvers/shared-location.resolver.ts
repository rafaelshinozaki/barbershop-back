import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { SharedLocationService } from '../../barbershop/shared-location.service';
import { SharedLocationLinkType, SharedLocationOverviewType } from '../types/public-booking.type';

/** Espaço compartilhado (cadeira alugada), do lado do espaço e do profissional */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class SharedLocationResolver {
  constructor(private readonly sharedLocationService: SharedLocationService) {}

  @Query(() => SharedLocationOverviewType)
  async sharedLocation(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.sharedLocationService.list(user.id, barbershopId);
  }

  /** O espaço convida o negócio do profissional pelo link (ou slug) da página dele */
  @Mutation(() => SharedLocationLinkType)
  async inviteToSharedLocation(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('memberPageLink') memberPageLink: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.sharedLocationService.invite(user.id, barbershopId, memberPageLink);
  }

  @Mutation(() => SharedLocationLinkType)
  async respondSharedLocationInvite(
    @Args('id', { type: () => Int }) id: number,
    @Args('accept') accept: boolean,
    @CurrentUser() user: UserDTO,
  ) {
    return this.sharedLocationService.respond(user.id, id, accept);
  }

  /** Encerra o vínculo, de qualquer um dos lados (barbershopId = quem encerra) */
  @Mutation(() => Boolean)
  async endSharedLocation(
    @Args('id', { type: () => Int }) id: number,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.sharedLocationService.end(user.id, id, barbershopId);
  }
}
