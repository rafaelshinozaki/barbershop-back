import { Args, Field, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { CalendarService, FeedScope } from '../../calendar/calendar.service';

@ObjectType()
export class CalendarFeedType {
  /** MINE (meus horários) | ALL (agenda da unidade) */
  @Field()
  scope: string;

  @Field()
  createdAt: Date;

  /** Última vez que o app de agenda buscou (confirma que a assinatura funciona) */
  @Field({ nullable: true })
  lastAccessAt?: Date | null;
}

@ObjectType()
export class CreatedCalendarFeedType {
  @Field()
  scope: string;

  /** Caminho na API (o front monta a URL completa); o token só aparece aqui */
  @Field()
  path: string;
}

/** Agenda assinável da equipe (Google Agenda, Apple, Outlook) */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class CalendarResolver {
  constructor(private readonly calendar: CalendarService) {}

  @Query(() => [CalendarFeedType])
  async myCalendarFeeds(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.calendar.listFeeds(user.id, barbershopId);
  }

  /** Cria ou troca o link (o anterior para de funcionar) */
  @Mutation(() => CreatedCalendarFeedType)
  async createCalendarFeed(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('scope') scope: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.calendar.createFeed(user.id, barbershopId, scope as FeedScope);
  }

  @Mutation(() => Boolean)
  async deleteCalendarFeed(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('scope') scope: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.calendar.deleteFeed(user.id, barbershopId, scope as FeedScope);
  }
}
