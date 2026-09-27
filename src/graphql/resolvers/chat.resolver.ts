import { Args, Context, Field, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ChatService } from '../../barbershop/chat.service';
import { ClientAuthService } from '../../client-auth/client-auth.service';
import { GraphQLClientJwtAuthGuard } from '../../client-auth/guards/graphql-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '../../client-auth/current-client.decorator';

// Mandar mensagem: 30 por minuto por IP/navegador
const ThrottleChat = () => Throttle({ default: { limit: 30, ttl: 60000 } });

@ObjectType()
export class ChatMessageType {
  @Field(() => Int)
  id: number;

  @Field()
  createdAt: Date;

  @Field({ description: 'client | staff' })
  side: string;

  @Field()
  body: string;

  @Field({ description: 'Escrita por quem está vendo' })
  mine: boolean;
}

@ObjectType()
export class ChatThreadType {
  @Field(() => Int)
  appointmentId: number;

  @Field({ description: 'unit (cliente e unidade) | professional (cliente e profissional)' })
  kind: string;

  @Field({
    description: 'O outro lado: a unidade ou o profissional (pro cliente); o cliente (pra equipe)',
  })
  title: string;

  @Field()
  startAt: Date;

  @Field({ description: 'Atendimento cancelado não recebe mensagem' })
  canSend: boolean;

  @Field(() => [ChatMessageType])
  messages: ChatMessageType[];
}

@ObjectType()
export class ChatInboxItemType {
  @Field(() => Int)
  appointmentId: number;

  @Field(() => Int)
  barbershopId: number;

  @Field()
  kind: string;

  @Field()
  title: string;

  @Field()
  subtitle: string;

  @Field()
  startAt: Date;

  @Field(() => Date, { nullable: true })
  lastMessageAt: Date | null;

  @Field(() => String, { nullable: true })
  lastMessage: string | null;

  @Field(() => Int)
  unread: number;
}

/**
 * Chat preso ao atendimento: o cliente (pela conta ou pelo link "gerenciar
 * agendamento" do e-mail, sem login) conversa com a unidade e com o
 * profissional; a equipe responde pelo detalhe do agendamento ou pela caixa
 * de entrada. Abrir a conversa marca como lidas as mensagens do outro lado.
 */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class ChatResolver {
  constructor(private readonly chat: ChatService, private readonly clientAuth: ClientAuthService) {}

  private async clientViewer(context: any, manageToken?: string | null) {
    return {
      side: 'client' as const,
      manageToken: manageToken ?? null,
      clientAccountId: await this.clientAuth.optionalClientAccountId(context.req),
    };
  }

  // ---- cliente ----

  @Query(() => [ChatThreadType])
  async clientAppointmentChats(
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @Context() context: any,
    @Args('manageToken', { nullable: true }) manageToken?: string,
  ) {
    return this.chat.threads(appointmentId, await this.clientViewer(context, manageToken));
  }

  @ThrottleChat()
  @Mutation(() => ChatMessageType)
  async clientSendChatMessage(
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @Args('kind') kind: string,
    @Args('body') body: string,
    @Context() context: any,
    @Args('manageToken', { nullable: true }) manageToken?: string,
  ) {
    return this.chat.send(appointmentId, kind, body, await this.clientViewer(context, manageToken));
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [ChatInboxItemType])
  clientChatInbox(@CurrentClient() client: CurrentClientUser) {
    return this.chat.clientInbox(client.id);
  }

  // ---- equipe ----

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [ChatThreadType])
  appointmentChats(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.chat.threads(appointmentId, { side: 'staff', userId: user.id }, barbershopId);
  }

  @ThrottleChat()
  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => ChatMessageType)
  sendChatMessage(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @Args('kind') kind: string,
    @Args('body') body: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.chat.send(
      appointmentId,
      kind,
      body,
      { side: 'staff', userId: user.id },
      barbershopId,
    );
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [ChatInboxItemType])
  myChatInbox(@CurrentUser() user: UserDTO) {
    return this.chat.staffInbox(user.id);
  }
}
