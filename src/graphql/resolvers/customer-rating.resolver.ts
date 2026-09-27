import {
  Args,
  Field,
  Float,
  GraphQLISODateTime,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { BadRequestException, UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { GraphQLClientJwtAuthGuard } from '../../client-auth/guards/graphql-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '../../client-auth/current-client.decorator';
import { CustomerRatingService, type RatingSide } from '../../barbershop/customer-rating.service';

/** Nota do cliente: médias de pontualidade e trato e o comparecimento */
@ObjectType()
export class CustomerConductType {
  @Field(() => Float, { nullable: true, description: 'Média de pontualidade (1 a 5)' })
  punctuality: number | null;

  @Field(() => Float, { nullable: true, description: 'Média de trato (1 a 5)' })
  treatment: number | null;

  @Field(() => Int, { description: 'Quantas avaliações compõem a média' })
  ratingCount: number;

  @Field(() => Int, { description: 'Atendimentos concluídos' })
  completed: number;

  @Field(() => Int, { description: 'Faltas' })
  noShows: number;

  @Field(() => Int, { nullable: true, description: 'Comparecimento em % (concluídos / marcados)' })
  attendanceRate: number | null;
}

@ObjectType()
export class CustomerRatingValueType {
  @Field({ description: 'unit | professional' })
  side: string;

  @Field(() => Int)
  punctuality: number;

  @Field(() => Int)
  treatment: number;
}

/** O que a pessoa logada pode avaliar num atendimento, e as notas já dadas */
@ObjectType()
export class AppointmentCustomerRatingType {
  @Field(() => Int)
  customerId: number;

  @Field(() => [String], {
    description: 'Lados que ela ainda pode avaliar agora (unit, professional)',
  })
  sides: string[];

  @Field(() => [CustomerRatingValueType])
  ratings: CustomerRatingValueType[];
}

@ObjectType()
export class PendingCustomerRatingType {
  @Field(() => Int)
  appointmentId: number;

  @Field(() => Int)
  barbershopId: number;

  @Field()
  barbershopName: string;

  @Field()
  customerName: string;

  @Field(() => GraphQLISODateTime)
  startAt: Date;

  @Field()
  serviceNames: string;
}

const SIDES: RatingSide[] = ['unit', 'professional'];

/** Nota do cliente dada pela unidade e pelo profissional (item 3 do roadmap) */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class CustomerRatingResolver {
  constructor(private readonly ratings: CustomerRatingService) {}

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => AppointmentCustomerRatingType)
  appointmentCustomerRating(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.ratings.forAppointment(user.id, barbershopId, appointmentId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  rateCustomer(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @Args('side') side: string,
    @Args('punctuality', { type: () => Int }) punctuality: number,
    @Args('treatment', { type: () => Int }) treatment: number,
    @CurrentUser() user: UserDTO,
  ) {
    if (!SIDES.includes(side as RatingSide)) throw new BadRequestException('Lado inválido');
    return this.ratings.rate(
      user.id,
      barbershopId,
      appointmentId,
      side as RatingSide,
      punctuality,
      treatment,
    );
  }

  /** Atendimentos recentes em que o profissional ainda não avaliou o cliente */
  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [PendingCustomerRatingType])
  myPendingCustomerRatings(@CurrentUser() user: UserDTO) {
    return this.ratings.pendingForMe(user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => CustomerConductType)
  customerConduct(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('customerId', { type: () => Int }) customerId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.ratings.conductForStaff(user.id, barbershopId, customerId);
  }

  /** Cliente logado: a própria nota e o que a compõe */
  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => CustomerConductType)
  myConduct(@CurrentClient() client: CurrentClientUser) {
    return this.ratings.myConduct(client.id);
  }
}
