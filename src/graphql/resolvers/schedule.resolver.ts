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
import { ScheduleService, ScheduleMode } from '../../barbershop/schedule.service';

@ObjectType()
export class BusinessDayType {
  @Field(() => Int, { description: '0 = domingo' })
  dayOfWeek: number;

  @Field()
  open: boolean;

  @Field({ nullable: true })
  start?: string | null;

  @Field({ nullable: true })
  end?: string | null;

  @Field({ description: 'A unidade ainda usa o horário padrão (nunca configurou)' })
  isDefault: boolean;
}

@InputType()
export class BusinessDayInput {
  @Field(() => Int)
  dayOfWeek: number;

  @Field()
  open: boolean;

  @Field({ nullable: true })
  start?: string;

  @Field({ nullable: true })
  end?: string;
}

@ObjectType()
export class WeeklyScheduleDayType {
  @Field(() => Int)
  dayOfWeek: number;

  @Field({ description: 'SHOP (horário da unidade) | CUSTOM (próprio) | OFF (folga fixa)' })
  mode: string;

  @Field({ nullable: true })
  startTime?: string | null;

  @Field({ nullable: true })
  endTime?: string | null;

  @Field({ nullable: true })
  breakStart?: string | null;

  @Field({ nullable: true })
  breakEnd?: string | null;

  @Field({ description: 'Atende nesse dia' })
  working: boolean;
}

@InputType()
export class WeeklyScheduleDayInput {
  @Field(() => Int)
  dayOfWeek: number;

  @Field({ description: 'SHOP | CUSTOM | OFF' })
  mode: string;

  @Field({ nullable: true })
  startTime?: string;

  @Field({ nullable: true })
  endTime?: string;

  @Field({ nullable: true })
  breakStart?: string;

  @Field({ nullable: true })
  breakEnd?: string;
}

/** Horário de funcionamento da unidade e escala semanal da equipe */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class ScheduleResolver {
  constructor(private readonly schedules: ScheduleService) {}

  @Query(() => [BusinessDayType])
  async businessHours(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.schedules.getBusinessHours(user.id, barbershopId);
  }

  @Mutation(() => [BusinessDayType])
  async setBusinessHours(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('days', { type: () => [BusinessDayInput] }) days: BusinessDayInput[],
    @CurrentUser() user: UserDTO,
  ) {
    return this.schedules.setBusinessHours(user.id, barbershopId, days);
  }

  @Query(() => [WeeklyScheduleDayType])
  async barberWeeklySchedule(
    @Args('barberId', { type: () => Int }) barberId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.schedules.getWeeklySchedule(user.id, barberId);
  }

  @Mutation(() => [WeeklyScheduleDayType])
  async setBarberWeeklySchedule(
    @Args('barberId', { type: () => Int }) barberId: number,
    @Args('days', { type: () => [WeeklyScheduleDayInput] }) days: WeeklyScheduleDayInput[],
    @CurrentUser() user: UserDTO,
  ) {
    return this.schedules.setWeeklySchedule(
      user.id,
      barberId,
      days.map((d) => ({ ...d, mode: d.mode as ScheduleMode })),
    );
  }
}
