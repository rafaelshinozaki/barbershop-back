import {
  Args,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { RealtimeService } from '../../realtime/realtime.service';
import { AppointmentSeriesService } from '../../barbershop/appointment-series.service';
import { AppointmentServiceInput } from '../dto/barbershop.dto';

@InputType()
export class AppointmentSeriesInput {
  @Field(() => Int)
  customerId: number;

  @Field(() => Int)
  barberId: number;

  @Field(() => Int, { nullable: true })
  resourceId?: number;

  @Field({ description: 'Primeiro horário' })
  startAt: string;

  @Field()
  endAt: string;

  @Field({ nullable: true })
  notes?: string;

  @Field(() => [AppointmentServiceInput])
  services: AppointmentServiceInput[];

  @Field(() => Int, { description: 'Repetir a cada N semanas (1 a 8)' })
  intervalWeeks: number;

  @Field(() => Int, { description: 'Quantos horários (2 a 26)' })
  occurrences: number;
}

@ObjectType()
export class SeriesSlotType {
  @Field(() => Int)
  index: number;

  @Field()
  startAt: Date;

  @Field()
  endAt: Date;

  @Field()
  ok: boolean;

  @Field({ nullable: true })
  reason?: string;

  @Field({ nullable: true })
  warning?: string;
}

@ObjectType()
export class CreatedSeriesType {
  @Field()
  seriesId: string;

  @Field(() => Int)
  createdCount: number;

  @Field(() => [SeriesSlotType])
  skipped: SeriesSlotType[];
}

/** Agendamento recorrente (cliente fixo a cada N semanas) */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class AppointmentSeriesResolver {
  constructor(
    private readonly series: AppointmentSeriesService,
    private readonly realtime: RealtimeService,
  ) {}

  private toInput(input: AppointmentSeriesInput) {
    return { ...input, startAt: new Date(input.startAt), endAt: new Date(input.endAt) };
  }

  @Query(() => [SeriesSlotType])
  async appointmentSeriesPreview(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: AppointmentSeriesInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.series.preview(user.id, barbershopId, this.toInput(input));
  }

  @Mutation(() => CreatedSeriesType)
  async createAppointmentSeries(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: AppointmentSeriesInput,
    @CurrentUser() user: UserDTO,
  ) {
    const result = await this.series.create(user.id, barbershopId, this.toInput(input));
    this.realtime.notify(barbershopId, 'APPOINTMENT', 'CREATED');
    return result;
  }

  /** Cancela este horário e os próximos da série */
  @Mutation(() => Int)
  async cancelAppointmentSeries(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @CurrentUser() user: UserDTO,
  ) {
    const { cancelledCount } = await this.series.cancelFromHere(
      user.id,
      barbershopId,
      appointmentId,
    );
    this.realtime.notify(barbershopId, 'APPOINTMENT', 'UPDATED');
    return cancelledCount;
  }
}
