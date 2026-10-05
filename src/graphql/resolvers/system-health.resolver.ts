import { Field, Float, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { MetricsService } from '../../metrics/metrics.service';

@ObjectType()
export class OperationStatsType {
  @Field()
  operation: string;

  @Field(() => Int)
  count: number;

  @Field(() => Int)
  errors: number;

  @Field(() => Int)
  p95Ms: number;
}

@ObjectType()
export class RequestStatsType {
  @Field(() => Int)
  requests: number;

  @Field(() => Int)
  errors: number;

  @Field(() => Float)
  errorRate: number;

  @Field(() => Int)
  p50Ms: number;

  @Field(() => Int)
  p95Ms: number;

  @Field(() => Int)
  maxMs: number;

  @Field(() => [OperationStatsType])
  slowest: OperationStatsType[];
}

@ObjectType()
export class QueueStatsType {
  @Field()
  name: string;

  @Field(() => Int)
  waiting: number;

  @Field(() => Int)
  active: number;

  @Field(() => Int)
  delayed: number;

  @Field(() => Int)
  failed: number;

  @Field(() => Int)
  oldestWaitingSec: number;
}

@ObjectType()
export class DbStatsType {
  @Field()
  ok: boolean;

  @Field(() => Int)
  pingMs: number;

  @Field(() => Int, { nullable: true })
  poolBusy?: number | null;

  @Field(() => Int, { nullable: true })
  poolIdle?: number | null;

  @Field(() => Int, { nullable: true })
  poolWaiting?: number | null;
}

@ObjectType()
export class RedisStatsType {
  @Field()
  ok: boolean;

  @Field(() => Int)
  pingMs: number;
}

@ObjectType()
export class MemoryStatsType {
  @Field(() => Float)
  rssMb: number;

  @Field(() => Float)
  heapUsedMb: number;
}

@ObjectType()
export class SystemHealthType {
  /** Fim do minuto medido */
  @Field()
  collectedAt: string;

  @Field()
  instance: string;

  @Field(() => Int)
  intervalSec: number;

  @Field(() => RequestStatsType)
  requests: RequestStatsType;

  @Field(() => MemoryStatsType)
  memory: MemoryStatsType;

  @Field(() => Float)
  cpuPercent: number;

  @Field(() => Float)
  eventLoopLagP99Ms: number;

  @Field(() => DbStatsType)
  db: DbStatsType;

  @Field(() => RedisStatsType)
  redis: RedisStatsType;

  @Field(() => [QueueStatsType])
  queues: QueueStatsType[];
}

/** Saúde do sistema (só o admin): o último minuto medido desta instância */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
export class SystemHealthResolver {
  constructor(private readonly metrics: MetricsService) {}

  /** Vazio no primeiro minuto depois de subir (ainda não fechou nenhum) */
  @Query(() => SystemHealthType, { nullable: true })
  systemHealth() {
    const s = this.metrics.latest();
    return s ? { ...s, collectedAt: s._time } : null;
  }
}
