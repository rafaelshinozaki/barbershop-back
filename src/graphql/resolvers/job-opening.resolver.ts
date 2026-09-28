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
import { Throttle } from '@nestjs/throttler';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { TreatmentCategory } from '../types/enums';
import { JobOpeningService } from '../../barbershop/job-opening.service';

// Candidatar-se: 30 por hora por pessoa/navegador
const ThrottleApply = () => Throttle({ default: { limit: 30, ttl: 3600000 } });

@InputType()
export class JobOpeningInput {
  @Field(() => Int)
  barbershopId: number;

  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => TreatmentCategory, {
    nullable: true,
    description: 'Especialidade; vazio = qualquer',
  })
  category?: TreatmentCategory;

  @Field({ description: 'AAAA-MM-DD, no fuso da unidade' })
  startDate: string;

  @Field({ description: 'AAAA-MM-DD, no fuso da unidade' })
  endDate: string;

  @Field({ nullable: true, description: 'Combinado de pagamento, em texto' })
  payInfo?: string;

  @Field(() => Int, { nullable: true, description: 'Quantas pessoas (1 a 10)' })
  slots?: number;
}

@ObjectType()
export class JobApplicantType {
  @Field(() => Int)
  id: number;

  @Field({ description: 'pending | accepted | rejected | withdrawn' })
  status: string;

  @Field({ nullable: true })
  message?: string;

  @Field()
  createdAt: string;

  @Field()
  name: string;

  @Field()
  identityVerified: boolean;

  @Field({ nullable: true, description: 'Página /p/:slug, se visível' })
  professionalSlug?: string;

  @Field(() => [String])
  cities: string[];
}

@ObjectType()
export class JobOpeningType {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barbershopId: number;

  @Field()
  barbershopName: string;

  @Field()
  barbershopSlug: string;

  @Field()
  city: string;

  @Field()
  state: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => TreatmentCategory, { nullable: true })
  category?: TreatmentCategory;

  @Field()
  startDate: string;

  @Field()
  endDate: string;

  @Field({ nullable: true })
  payInfo?: string;

  @Field(() => Int)
  slots: number;

  @Field({ description: 'open | filled | closed' })
  status: string;

  @Field()
  createdAt: string;

  @Field(() => [JobApplicantType], { nullable: true, description: 'Só na visão da unidade' })
  applications?: JobApplicantType[];

  @Field(() => Int, { nullable: true, description: 'Minha candidatura (visão do profissional)' })
  myApplicationId?: number;

  @Field({ nullable: true })
  myApplicationStatus?: string;
}

@ObjectType()
export class MyJobApplicationType {
  @Field(() => Int)
  id: number;

  @Field()
  status: string;

  @Field({ nullable: true })
  message?: string;

  @Field()
  createdAt: string;

  @Field(() => JobOpeningType)
  opening: JobOpeningType;
}

@ObjectType()
export class JobApplyResultType {
  @Field(() => Int)
  id: number;

  @Field()
  status: string;
}

@Resolver()
@UseFilters(GqlHttpExceptionFilter)
@UseGuards(GraphQLJwtAuthGuard)
export class JobOpeningResolver {
  constructor(private readonly jobs: JobOpeningService) {}

  // ---- Unidade (gerente e dono) ----

  @Query(() => [JobOpeningType])
  barbershopJobOpenings(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
  ) {
    return this.jobs.shopOpenings(user.id, barbershopId);
  }

  @Mutation(() => JobOpeningType)
  createJobOpening(@CurrentUser() user: UserDTO, @Args('input') input: JobOpeningInput) {
    return this.jobs.create(user.id, input);
  }

  @Mutation(() => JobOpeningType)
  closeJobOpening(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
  ) {
    return this.jobs.close(user.id, barbershopId, id);
  }

  @Mutation(() => JobOpeningType)
  acceptJobApplication(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('applicationId', { type: () => Int }) applicationId: number,
  ) {
    return this.jobs.accept(user.id, barbershopId, applicationId);
  }

  @Mutation(() => JobOpeningType)
  rejectJobApplication(
    @CurrentUser() user: UserDTO,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('applicationId', { type: () => Int }) applicationId: number,
  ) {
    return this.jobs.reject(user.id, barbershopId, applicationId);
  }

  // ---- Profissional ----

  @Query(() => [JobOpeningType])
  openJobOpenings(
    @CurrentUser() user: UserDTO,
    @Args('city', { nullable: true }) city?: string,
    @Args('category', { type: () => TreatmentCategory, nullable: true })
    category?: TreatmentCategory,
  ) {
    return this.jobs.openOpenings(user.id, { city, category });
  }

  @Query(() => [MyJobApplicationType])
  myJobApplications(@CurrentUser() user: UserDTO) {
    return this.jobs.myApplications(user.id);
  }

  @ThrottleApply()
  @Mutation(() => JobApplyResultType)
  applyToJobOpening(
    @CurrentUser() user: UserDTO,
    @Args('openingId', { type: () => Int }) openingId: number,
    @Args('message', { nullable: true }) message?: string,
  ) {
    return this.jobs.apply(user.id, openingId, message);
  }

  @Mutation(() => Boolean)
  withdrawJobApplication(
    @CurrentUser() user: UserDTO,
    @Args('applicationId', { type: () => Int }) applicationId: number,
  ) {
    return this.jobs.withdraw(user.id, applicationId);
  }
}
