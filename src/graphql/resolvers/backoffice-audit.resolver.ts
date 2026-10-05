import { UseGuards } from '@nestjs/common';
import { Args, Field, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { BackofficeAuditService } from '../../backoffice/audit/backoffice-audit.service';
import { ChangeFieldType } from './change-log.resolver';

/** O que a ação mudou de fato (histórico de alterações do mesmo request) */
@ObjectType()
export class BackofficeAuditChangeType {
  /** Barbershop, User, ClientAccount, Professional… */
  @Field()
  entityType: string;

  @Field()
  entityId: string;

  @Field(() => String, { nullable: true })
  entityName?: string | null;

  /** create | update | delete */
  @Field()
  action: string;

  @Field(() => Int, { nullable: true })
  barbershopId?: number | null;

  @Field(() => String, { nullable: true })
  barbershopName?: string | null;

  @Field(() => [ChangeFieldType])
  fields: ChangeFieldType[];
}

@ObjectType()
export class BackofficeAuditEntryType {
  @Field(() => Int)
  id: number;

  @Field()
  createdAt: Date;

  @Field(() => Int, { nullable: true })
  actorId?: number | null;

  @Field()
  actorEmail: string;

  @Field()
  actorRole: string;

  @Field()
  operation: string;

  @Field(() => String, { nullable: true })
  area?: string | null;

  /** Dados da operação em JSON (sem senhas nem tokens) */
  @Field(() => String, { nullable: true })
  args?: string | null;

  @Field()
  success: boolean;

  @Field(() => String, { nullable: true })
  error?: string | null;

  /** Id do request (o mesmo do Sentry e da trilha) */
  @Field(() => String, { nullable: true })
  requestId?: string | null;

  /** Antes → depois do que a ação mudou (vazio: leitura, erro ou tabela sem histórico) */
  @Field(() => [BackofficeAuditChangeType])
  changes: BackofficeAuditChangeType[];
}

@ObjectType()
export class BackofficeAuditPageType {
  @Field(() => Int)
  total: number;

  @Field(() => [BackofficeAuditEntryType])
  items: BackofficeAuditEntryType[];
}

/** Registro de ações do backoffice: só o admin do sistema lê. */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
export class BackofficeAuditResolver {
  constructor(private readonly audit: BackofficeAuditService) {}

  @Query(() => BackofficeAuditPageType)
  backofficeAuditLog(
    @Args('actorId', { type: () => Int, nullable: true }) actorId?: number,
    @Args('operation', { type: () => String, nullable: true }) operation?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ) {
    return this.audit.list({ actorId, operation, limit, offset });
  }
}
