import { Args, Field, Float, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { PilotMetricsService } from '../../barbershop/pilot-metrics.service';

@ObjectType()
export class PilotCategoryMetricsType {
  /** Categoria buscada; ANY = sem categoria */
  @Field()
  category: string;

  @Field(() => Int)
  searches: number;

  @Field(() => Int)
  evaluated: number;

  @Field(() => Int)
  foundWithin48h: number;

  @Field(() => Float, { nullable: true })
  foundRate: number | null;
}

@ObjectType()
export class PilotMetricsType {
  @Field(() => Int)
  days: number;

  @Field(() => String, { nullable: true })
  city: string | null;

  @Field(() => Int)
  searches: number;

  /** Buscas já avaliadas pelo job (as últimas minutos ainda não) */
  @Field(() => Int)
  evaluated: number;

  @Field(() => Int)
  foundWithin48h: number;

  /** Buscas que acharam horário em até 48 h ÷ avaliadas (meta do piloto: > 0,5) */
  @Field(() => Float, { nullable: true })
  foundRate: number | null;

  @Field(() => [PilotCategoryMetricsType])
  byCategory: PilotCategoryMetricsType[];

  /** Agendamentos online vindos da busca/vitrine da plataforma */
  @Field(() => Int)
  marketplaceBookings: number;

  /** Desses, clientes novos no negócio */
  @Field(() => Int)
  marketplaceNewClients: number;

  /** Agendamentos online pelo link, QR ou site do próprio negócio */
  @Field(() => Int)
  directBookings: number;
}

/** Backoffice → Piloto: liquidez da busca e agendamentos da vitrine */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class PilotResolver {
  constructor(private readonly pilot: PilotMetricsService) {}

  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @Query(() => PilotMetricsType)
  pilotMetrics(
    @Args('days', { type: () => Int, nullable: true }) days?: number,
    @Args('city', { type: () => String, nullable: true }) city?: string | null,
  ) {
    return this.pilot.metrics(days ?? 7, city);
  }
}
