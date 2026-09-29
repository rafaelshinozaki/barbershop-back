import { UseGuards } from '@nestjs/common';
import { Args, Field, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { BackofficeTeamService } from '../../backoffice/backoffice-team.service';

@ObjectType()
export class BackofficeTeamMemberType {
  @Field(() => Int)
  id: number;

  @Field()
  fullName: string;

  @Field()
  email: string;

  @Field()
  role: string;

  @Field()
  isActive: boolean;

  @Field()
  twoFactorEnabled: boolean;

  @Field(() => [String])
  backofficeAreas: string[];
}

/** Equipe do sistema e as áreas do backoffice de cada um: só o admin. */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
export class BackofficeTeamResolver {
  constructor(private readonly team: BackofficeTeamService) {}

  @Query(() => [BackofficeTeamMemberType])
  backofficeTeam() {
    return this.team.team();
  }

  @Mutation(() => [String])
  setBackofficeAreas(
    @Args('userId', { type: () => Int }) userId: number,
    @Args('areas', { type: () => [String] }) areas: string[],
  ) {
    return this.team.setAreas(userId, areas);
  }
}
