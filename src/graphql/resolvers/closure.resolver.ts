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
import { ClosureService } from '../../barbershop/closure.service';
import { ClosureType } from '../types/public-booking.type';
import { RealtimeService } from '../../realtime/realtime.service';
import { ActivityNotificationsService } from '../../notifications/activity-notifications.service';

@InputType()
export class ClosureInput {
  @Field({ description: 'YYYY-MM-DD' })
  date: string;

  @Field({ nullable: true, description: 'Último dia (inclusive), pra vários dias' })
  endDate?: string;

  @Field({ nullable: true, description: 'Horário especial; sem = fechado o dia todo' })
  openTime?: string;

  @Field({ nullable: true })
  closeTime?: string;

  @Field({ nullable: true })
  reason?: string;

  @Field({ nullable: true, description: 'Cancelar e avisar os agendamentos afetados' })
  cancelAffected?: boolean;
}

@ObjectType()
export class ClosureImpactType {
  @Field(() => Int)
  id: number;

  @Field()
  startAt: Date;

  @Field()
  customerName: string;

  @Field()
  barberName: string;

  @Field()
  hasEmail: boolean;
}

@ObjectType()
export class SetClosureResultType {
  @Field(() => [String])
  dates: string[];

  @Field(() => Int)
  affectedCount: number;

  @Field(() => Int)
  cancelledCount: number;
}

/** Feriados e fechamentos da unidade */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class ClosureResolver {
  constructor(
    private readonly closures: ClosureService,
    private readonly realtime: RealtimeService,
    private readonly activity: ActivityNotificationsService,
  ) {}

  @Query(() => [ClosureType])
  async barbershopClosures(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.closures.list(user.id, barbershopId);
  }

  @Query(() => [ClosureImpactType])
  async closureImpact(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: ClosureInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.closures.impact(user.id, barbershopId, input);
  }

  @Mutation(() => SetClosureResultType)
  async setBarbershopClosure(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: ClosureInput,
    @CurrentUser() user: UserDTO,
  ) {
    const result = await this.closures.set(user.id, barbershopId, input);
    // Horários cancelados (ou reservas de sinal liberadas): a agenda aberta
    // atualiza na hora, e cada cancelamento entra na atividade, como no avulso
    if (result.cancelledIds.length || result.releasedHolds) {
      this.realtime.notify(barbershopId, 'APPOINTMENT', 'UPDATED');
    }
    for (const id of result.cancelledIds) {
      void this.activity.appointmentStatusChanged(id, 'CANCELLED', user.id);
    }
    return result;
  }

  @Mutation(() => Boolean)
  async deleteBarbershopClosure(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('date') date: string,
    @Args('endDate', { nullable: true }) endDate: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.closures.remove(user.id, barbershopId, date, endDate);
  }
}
