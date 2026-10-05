import { Args, Field, Float, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { BackofficeArea, RequireArea } from '../../auth/backoffice-areas';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { BarbershopDossierService } from '../../backoffice/barbershop-dossier.service';
import { ChangeLogPageType } from './change-log.resolver';

@ObjectType()
export class DossierOwnerType {
  @Field(() => Int)
  id: number;

  @Field()
  fullName: string;

  @Field()
  email: string;

  @Field()
  membership: string;

  @Field(() => Date, { nullable: true })
  proUntil?: Date | null;

  @Field()
  isActive: boolean;
}

@ObjectType()
export class DossierTeamMemberType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  staffType?: string | null;

  @Field()
  isActive: boolean;

  /** Tem conta pra entrar no app (senão é só um nome na agenda) */
  @Field()
  hasAccount: boolean;
}

@ObjectType()
export class DossierPaymentsType {
  /** Tem conta Stripe Connect (receber pelo app) */
  @Field()
  connected: boolean;

  @Field()
  chargesEnabled: boolean;

  @Field()
  payoutsEnabled: boolean;
}

@ObjectType()
export class BarbershopDossierType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  businessType: string;

  @Field()
  practiceKind: string;

  @Field()
  city: string;

  @Field()
  state: string;

  @Field()
  isActive: boolean;

  @Field()
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  featuredUntil?: Date | null;

  /** Tirada da busca pela moderação */
  @Field()
  hiddenFromSearch: boolean;

  @Field()
  onlineDeposit: boolean;

  @Field(() => String, { nullable: true })
  networkName?: string | null;

  @Field(() => DossierOwnerType, { nullable: true })
  owner?: DossierOwnerType | null;

  @Field(() => [DossierTeamMemberType])
  team: DossierTeamMemberType[];

  @Field(() => Int)
  activeServices: number;

  @Field(() => Int)
  customers: number;

  @Field(() => Int)
  appointments30d: number;

  @Field(() => Int)
  completed30d: number;

  @Field(() => Int)
  cancelled30d: number;

  @Field(() => Int)
  noShow30d: number;

  @Field(() => Float, { nullable: true })
  reviewAverage?: number | null;

  @Field(() => Int)
  reviewCount: number;

  @Field(() => DossierPaymentsType)
  payments: DossierPaymentsType;

  /** Pedidos de suporte do dono ainda não fechados */
  @Field(() => Int)
  openSupportTickets: number;

  /** Denúncias abertas sobre fotos da unidade */
  @Field(() => Int)
  openReports: number;
}

/** Ficha da unidade no backoffice (só leitura), área Usuários */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class BackofficeBarbershopResolver {
  constructor(private readonly dossier: BarbershopDossierService) {}

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.USERS)
  @Query(() => BarbershopDossierType)
  adminBarbershopDossier(@Args('barbershopId', { type: () => Int }) barbershopId: number) {
    return this.dossier.detail(barbershopId);
  }

  /** Histórico da unidade com o nome de quem fez (registro interno) */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.USERS)
  @Query(() => ChangeLogPageType)
  adminBarbershopChangeLog(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ) {
    return this.dossier.changeLog(barbershopId, limit ?? 30, offset ?? 0);
  }
}
