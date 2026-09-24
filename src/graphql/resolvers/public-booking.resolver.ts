import { PrismaService } from '../../prisma/prisma.service';
import { Resolver, Query, Mutation, Args, Int, Context } from '@nestjs/graphql';
import { NotFoundException, UseGuards, UseFilters } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { RealtimeService } from '../../realtime/realtime.service';
import { ActivityNotificationsService } from '../../notifications/activity-notifications.service';
import { BarbershopService } from '@/barbershop/barbershop.service';
import { ClientTokenPayload } from '@/client-auth/interfaces/client-token-payload.interface';
import { GraphQLClientJwtAuthGuard } from '@/client-auth/guards/graphql-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '@/client-auth/current-client.decorator';
import {
  PublicBarbershopType,
  PublicAppointmentType,
  PublicBarbershopSearchResultType,
  ReviewType,
  MyReviewType,
} from '../types/public-booking.type';
import {
  ClientSubscriptionType,
  SubscribeToPlanResultType,
  SubscriptionSetupIntentType,
} from '../types/barbershop.type';
import {
  CreatePublicAppointmentInput,
  SearchBarbershopsInput,
  CreateReviewInput,
  SubscribeToPlanInput,
} from '../dto/public-booking.dto';
import { ThrottleAuth, ThrottlePublicBooking } from '@/common/decorators/throttle.decorator';
import { TreatmentCategory } from '../types/enums';

// Sem @UseGuards em nenhum método — esta é a superfície pública da API,
// pensada pra ser acessada por qualquer visitante (a página de uma unidade
// e o fluxo de auto-agendamento não pedem login).
// @UseFilters: sem isso, o Apollo Server 4 mascara qualquer HttpException
// (daqui ou de dentro de BarbershopService) como "Internal server error"
// genérico — visitante nunca via a mensagem real (ex.: "Agendamento não
// encontrado"). Mesmo filtro já usado em AuthResolver.
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class PublicBookingResolver {
  constructor(
    private readonly barbershopService: BarbershopService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly activity: ActivityNotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Query(() => PublicBarbershopType)
  async publicBarbershop(@Args('slug') slug: string) {
    return this.barbershopService.getPublicBarbershopByslug(slug);
  }

  // Mesma página pública, resolvida pelo subdomínio próprio da unidade em
  // vez do slug — usado quando o front detecta um host tipo
  // subdominio.<domínio da plataforma>.
  @Query(() => PublicBarbershopType)
  async publicBarbershopBySubdomain(@Args('subdomain') subdomain: string) {
    return this.barbershopService.getPublicBarbershopBySubdomain(subdomain);
  }

  @Query(() => [TreatmentCategory])
  async publicServiceCategories() {
    return this.barbershopService.getPublicServiceCategories();
  }

  @Query(() => [PublicBarbershopSearchResultType])
  async searchBarbershops(@Args('input') input: SearchBarbershopsInput) {
    return this.barbershopService.searchPublicBarbershops(input);
  }

  @Query(() => [String])
  async publicCities() {
    return this.barbershopService.getPublicCities();
  }

  @Query(() => [String])
  async publicAvailableSlots(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('barberId', { type: () => Int }) barberId: number,
    @Args('serviceId', { type: () => Int }) serviceId: number,
    @Args('date') date: string,
  ) {
    return this.barbershopService.getPublicAvailableSlots(barbershopId, barberId, serviceId, date);
  }

  // Se o visitante já estiver logado como cliente da plataforma (cookie
  // ClientAuthentication), liga o agendamento à conta dele automaticamente —
  // sem exigir login pra quem não tem/não quer conta.
  private async getOptionalClientAccountId(req: any): Promise<number | undefined> {
    const token = req?.cookies?.ClientAuthentication;
    if (!token) return undefined;
    try {
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as ClientTokenPayload;
      // Cookie de sessão encerrada (senha trocada) não vale mais
      const account = await this.prisma.clientAccount.findUnique({
        where: { id: decoded.clientAccountId },
        select: { sessionVersion: true },
      });
      return account && (decoded.v ?? 0) === account.sessionVersion
        ? decoded.clientAccountId
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Descadastro pelo link do e-mail de marketing (página /unsubscribe do
   * front). Devolve o nome da rede pra tela confirmar de onde saiu.
   */
  @ThrottleAuth()
  @Mutation(() => String)
  async unsubscribeFromMarketing(@Args('token') token: string): Promise<string> {
    return this.barbershopService.unsubscribeFromMarketing(token);
  }

  @ThrottlePublicBooking()
  @Mutation(() => PublicAppointmentType)
  async createPublicAppointment(
    @Args('input') input: CreatePublicAppointmentInput,
    @Context() context: any,
  ): Promise<PublicAppointmentType> {
    const clientAccountId = await this.getOptionalClientAccountId(context.req);
    const appointment = await this.barbershopService.createPublicAppointment({
      ...input,
      clientAccountId,
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    // Agendamento feito pelo cliente aparece na hora no dashboard da unidade
    this.realtime.notify(appointment.barbershopId, 'APPOINTMENT', 'CREATED');
    // O agendamento público pode ter cadastrado um cliente novo (card
    // "Clientes" da visão geral)
    this.realtime.notify(appointment.barbershopId, 'CUSTOMER', 'CREATED');
    void this.activity.appointmentCreated(appointment.id, null);

    const service = appointment.services[0]?.service;
    return {
      id: appointment.id,
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt.toISOString(),
      status: appointment.status,
      barbershopName: appointment.barbershop.name,
      barberName: appointment.barber.name,
      serviceName: service?.name ?? '',
      price: service ? Number(service.price) : 0,
      currency: appointment.barbershop.currency,
      depositAmount:
        appointment.depositAmount != null ? Number(appointment.depositAmount) : undefined,
    };
  }

  @Query(() => [ReviewType])
  async barbershopReviews(@Args('barbershopId', { type: () => Int }) barbershopId: number) {
    return this.barbershopService.getBarbershopReviews(barbershopId);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => MyReviewType, { nullable: true })
  async myReview(
    @CurrentClient() client: CurrentClientUser,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
  ) {
    return this.barbershopService.getMyReview(client.id, barbershopId);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => Boolean)
  async canReviewBarbershop(
    @CurrentClient() client: CurrentClientUser,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
  ) {
    return this.barbershopService.canReviewBarbershop(client.id, barbershopId);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => Boolean)
  async createOrUpdateReview(
    @CurrentClient() client: CurrentClientUser,
    @Args('input') input: CreateReviewInput,
  ) {
    await this.barbershopService.createOrUpdateReview(
      client.id,
      input.barbershopId,
      input.rating,
      input.comment,
    );
    void this.activity.reviewPosted(input.barbershopId, client.id, input.rating, input.comment);
    return true;
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteReview(
    @CurrentClient() client: CurrentClientUser,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
  ) {
    await this.barbershopService.deleteReview(client.id, barbershopId);
    return true;
  }

  // ============ ASSINATURA RECORRENTE DO CLIENTE ============

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => SubscriptionSetupIntentType)
  async createClientSubscriptionSetupIntent(@CurrentClient() client: CurrentClientUser) {
    return this.barbershopService.createClientSubscriptionSetupIntent(client.id);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => SubscribeToPlanResultType)
  async subscribeToPlan(
    @CurrentClient() client: CurrentClientUser,
    @Args('input') input: SubscribeToPlanInput,
  ) {
    return this.barbershopService.subscribeToPlan(
      client.id,
      input.barbershopId,
      input.planId,
      input.paymentMethodId,
    );
  }

  // Nome diferente de "mySubscriptions" (já usado por payment.resolver.ts /
  // plan.resolver.ts pra assinatura SaaS do dono da barbearia) — mesmo nome
  // de campo Query em resolvers diferentes colide no schema (o último
  // registrado vence silenciosamente, sem erro de build).
  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [ClientSubscriptionType])
  async myClientSubscriptions(@CurrentClient() client: CurrentClientUser) {
    return this.barbershopService.getMySubscriptions(client.id);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => Boolean)
  async cancelMySubscription(
    @CurrentClient() client: CurrentClientUser,
    @Args('subscriptionId', { type: () => Int }) subscriptionId: number,
  ) {
    return this.barbershopService.cancelMySubscription(client.id, subscriptionId);
  }
}
