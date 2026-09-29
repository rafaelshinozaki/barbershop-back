import { Args, Context, Field, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ThrottleReport } from '../../common/decorators/throttle.decorator';
import { ModerationService } from '../../barbershop/moderation.service';
import { BackofficeArea, RequireArea } from '../../auth/backoffice-areas';

@ObjectType()
export class ReportReasonCountType {
  @Field()
  reason: string;

  @Field(() => Int)
  count: number;
}

/** Um conteúdo denunciado na fila do admin */
@ObjectType()
export class ModerationItemType {
  @Field({ description: 'photo | professional_review | professional_profile | barbershop' })
  targetType: string;

  @Field(() => Int)
  targetId: number;

  @Field()
  title: string;

  @Field(() => String, { nullable: true })
  text: string | null;

  @Field(() => String, { nullable: true })
  imageUrl: string | null;

  @Field(() => String, { nullable: true, description: 'Página pública do conteúdo' })
  link: string | null;

  @Field({ description: 'Oculto pela moderação' })
  hidden: boolean;

  @Field(() => Int)
  openReports: number;

  @Field(() => [ReportReasonCountType])
  reasons: ReportReasonCountType[];

  @Field(() => [String])
  details: string[];

  @Field()
  lastReportedAt: Date;
}

const clientIp = (req: any): string => {
  const forwarded = req?.headers?.['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first || req?.ip || req?.socket?.remoteAddress || 'unknown').trim();
};

/** Denúncia de conteúdo público e a fila de moderação do admin da plataforma */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class ModerationResolver {
  constructor(private readonly moderation: ModerationService) {}

  /** Qualquer visitante, sem login */
  @ThrottleReport()
  @Mutation(() => Boolean)
  reportContent(
    @Args('targetType') targetType: string,
    @Args('targetId', { type: () => Int }) targetId: number,
    @Args('reason') reason: string,
    @Context() context: any,
    @Args('details', { nullable: true }) details?: string,
  ) {
    return this.moderation.report({ targetType, targetId, reason, details }, clientIp(context.req));
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.MODERATION)
  @Query(() => [ModerationItemType])
  moderationQueue() {
    return this.moderation.queue();
  }

  /** hide | dismiss | restore */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.MODERATION)
  @Mutation(() => Boolean)
  resolveContentReports(
    @Args('targetType') targetType: string,
    @Args('targetId', { type: () => Int }) targetId: number,
    @Args('action') action: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.moderation.resolve(user.id, targetType, targetId, action);
  }
}
