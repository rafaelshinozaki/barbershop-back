import { Args, Field, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ChangeLogService } from '../../barbershop/change-log.service';

@ObjectType()
export class ChangeFieldType {
  @Field()
  field: string;

  /** Valor antes (texto; a tela formata pelo campo). Telefone/e-mail mascarados, observação "•••" */
  @Field(() => String, { nullable: true })
  before?: string | null;

  @Field(() => String, { nullable: true })
  after?: string | null;
}

@ObjectType()
export class ChangeLogEntryType {
  @Field(() => Int)
  id: number;

  @Field()
  createdAt: Date;

  /** Barbershop, BarbershopService, Appointment, Customer… */
  @Field()
  entityType: string;

  @Field()
  entityId: string;

  @Field(() => String, { nullable: true })
  entityName?: string | null;

  /** create | update | delete */
  @Field()
  action: string;

  @Field(() => [ChangeFieldType])
  changes: ChangeFieldType[];

  /** user | client | platform (equipe da plataforma, sem nome) | system */
  @Field()
  actorKind: string;

  @Field(() => Int, { nullable: true })
  actorId?: number | null;

  @Field(() => String, { nullable: true })
  actorName?: string | null;

  /** Motivo, quando a equipe da plataforma mexeu */
  @Field(() => String, { nullable: true })
  reason?: string | null;
}

@ObjectType()
export class ChangeLogPageType {
  @Field(() => Int)
  total: number;

  @Field(() => [ChangeLogEntryType])
  items: ChangeLogEntryType[];
}

@ObjectType()
export class ChangeLogActorType {
  @Field(() => Int)
  id: number;

  @Field(() => String, { nullable: true })
  name?: string | null;

  /** user | client */
  @Field()
  kind: string;
}

/** Histórico de alterações da unidade (dono e gerente; o profissional, só a própria agenda) */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class ChangeLogResolver {
  constructor(private readonly changeLog: ChangeLogService) {}

  @Query(() => ChangeLogPageType)
  async barbershopChangeLog(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
    @Args('entityType', { type: () => String, nullable: true }) entityType?: string,
    @Args('actorId', { type: () => Int, nullable: true }) actorId?: number,
    @Args('from', { type: () => Date, nullable: true }) from?: Date,
    @Args('to', { type: () => Date, nullable: true }) to?: Date,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ) {
    return this.changeLog.list(user.id, barbershopId, {
      entityType,
      actorId,
      from,
      to,
      limit,
      offset,
    });
  }

  @Query(() => [ChangeLogActorType])
  async barbershopChangeLogActors(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.changeLog.actors(user.id, barbershopId);
  }
}
