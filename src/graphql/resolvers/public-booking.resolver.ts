import { PrismaService } from '../../prisma/prisma.service';
import { Resolver, Query, Mutation, Args, Int, Context } from '@nestjs/graphql';
import { NotFoundException, UseGuards, UseFilters } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { RealtimeService } from '../../realtime/realtime.service';
import { ActivityNotificationsService } from '../../notifications/activity-notifications.service';
import { BarbershopService } from '@/barbershop/barbershop.service';
import { SharedLocationService } from '@/barbershop/shared-location.service';
import { ReviewRequestService } from '@/barbershop/review-request.service';
import { ClosureService } from '@/barbershop/closure.service';
import { DepositPaymentService } from '@/barbershop/deposit-payment.service';
import { ClientTokenPayload } from '@/client-auth/interfaces/client-token-payload.interface';
import { GraphQLClientJwtAuthGuard } from '@/client-auth/guards/graphql-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '@/client-auth/current-client.decorator';
import {
  PublicBarbershopType,
  PublicAppointmentType,
  PublicNextSlotType,
  ReviewRequestType,
  DepositPaymentType,
  ManagedAppointmentType,
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
import {
  ThrottleAuth,
  ThrottlePublicBooking,
  ThrottleSlotSearch,
} from '@/common/decorators/throttle.decorator';
import { TreatmentCategory } from '../types/enums';
import { createAppointmentToken } from '@/barbershop/appointment-link';

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
    private readonly sharedLocation: SharedLocationService,
    private readonly reviewRequests: ReviewRequestService,
    private readonly closures: ClosureService,
    private readonly deposits: DepositPaymentService,
  ) {}

  @Query(() => PublicBarbershopType)
  async publicBarbershop(@Args('slug') slug: string) {
    return this.withSharedLocation(await this.barbershopService.getPublicBarbershopByslug(slug));
  }

  private async withSharedLocation<T extends { id: number; timezone?: string | null }>(shop: T) {
    const [links, closures] = await Promise.all([
      this.sharedLocation.publicLinks(shop.id),
      this.closures.upcomingPublic(shop.id, shop.timezone),
    ]);
    return { ...shop, ...links, closures };
  }

  // Mesma página pública, resolvida pelo subdomínio próprio da unidade em
  // vez do slug — usado quando o front detecta um host tipo
  // subdominio.<domínio da plataforma>.
  @Query(() => PublicBarbershopType)
  async publicBarbershopBySubdomain(@Args('subdomain') subdomain: string) {
    return this.withSharedLocation(
      await this.barbershopService.getPublicBarbershopBySubdomain(subdomain),
    );
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
    @Args('date') date: string,
    /** Sem profissional: "qualquer profissional" (livre com pelo menos um) */
    @Args('barberId', { type: () => Int, nullable: true }) barberId?: number | null,
    /** Um serviço (compatibilidade) ou vários, em sequência */
    @Args('serviceId', { type: () => Int, nullable: true }) serviceId?: number | null,
    @Args('serviceIds', { type: () => [Int], nullable: true }) serviceIds?: number[] | null,
  ) {
    return this.barbershopService.getPublicAvailableSlots(
      barbershopId,
      barberId ?? null,
      serviceIds?.length ? serviceIds : serviceId != null ? [serviceId] : [],
      date,
    );
  }

  /** Próximo horário livre (do profissional ou, sem ele, de qualquer um) */
  @Query(() => PublicNextSlotType, { nullable: true })
  @ThrottleSlotSearch()
  async publicNextAvailableSlot(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('serviceIds', { type: () => [Int] }) serviceIds: number[],
    @Args('barberId', { type: () => Int, nullable: true }) barberId?: number | null,
    @Args('fromDate', { nullable: true }) fromDate?: string | null,
  ) {
    return this.barbershopService.getPublicNextAvailableSlot(
      barbershopId,
      barberId ?? null,
      serviceIds,
      fromDate,
    );
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
    const { serviceId, serviceIds, ...rest } = input;
    const appointment = await this.barbershopService.createPublicAppointment({
      ...rest,
      serviceIds: serviceIds?.length ? serviceIds : serviceId != null ? [serviceId] : [],
      clientAccountId,
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    // Agendamento feito pelo cliente aparece na hora no dashboard da unidade
    this.realtime.notify(appointment.barbershopId, 'APPOINTMENT', 'CREATED');
    // O agendamento público pode ter cadastrado um cliente novo (card
    // "Clientes" da visão geral)
    this.realtime.notify(appointment.barbershopId, 'CUSTOMER', 'CREATED');
    void this.activity.appointmentCreated(appointment.id, null);

    const serviceNames = appointment.services
      .map((s) => s.service?.name)
      .filter(Boolean)
      .join(' + ');
    const price = appointment.services.reduce((sum, s) => sum + Number(s.unitPrice), 0);
    return {
      id: appointment.id,
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt.toISOString(),
      status: appointment.status,
      barbershopName: appointment.barbershop.name,
      barberName: appointment.barber.name,
      serviceName: serviceNames,
      price,
      currency: appointment.barbershop.currency,
      depositAmount:
        appointment.depositAmount != null ? Number(appointment.depositAmount) : undefined,
      // Quem acabou de agendar já pode cancelar/remarcar pela tela de confirmação
      manageToken: createAppointmentToken(appointment.id),
    };
  }

  // ---- Cliente gerencia o próprio horário pelo link do e-mail ----
  // O token é assinado (HMAC) e só abre aquele agendamento; o limite de
  // tentativas segura quem tentar adivinhar.

  @ThrottleAuth()
  @Query(() => ManagedAppointmentType)
  async managedAppointment(@Args('token') token: string) {
    return this.barbershopService.getManagedAppointment(token);
  }

  @ThrottleAuth()
  @Mutation(() => ManagedAppointmentType)
  async cancelManagedAppointment(@Args('token') token: string) {
    const { id, barbershopId } = await this.barbershopService.cancelManagedAppointment(token);
    // Cancelou dentro do prazo: o sinal pago online volta pro cartão
    await this.deposits.refundOnClientCancel(id);
    this.realtime.notify(barbershopId, 'APPOINTMENT', 'UPDATED');
    void this.activity.appointmentStatusChanged(id, 'CANCELLED', null);
    return this.barbershopService.getManagedAppointment(token);
  }

  /** Sinal online: começa (ou retoma) o pagamento do horário reservado */
  @ThrottleSlotSearch()
  @Mutation(() => DepositPaymentType)
  async startDepositPayment(@Args('token') token: string) {
    return this.deposits.start(token);
  }

  /** A tela voltou do cartão: confere no Stripe e confirma o horário */
  @ThrottleSlotSearch()
  @Mutation(() => ManagedAppointmentType)
  async confirmDepositPayment(@Args('token') token: string) {
    const status = await this.deposits.confirm(token);
    const appt = await this.barbershopService.getManagedAppointment(token);
    if (status === 'CONFIRMED') this.realtime.notify(appt.barbershopId, 'APPOINTMENT', 'UPDATED');
    return appt;
  }

  @ThrottlePublicBooking()
  @Mutation(() => ManagedAppointmentType)
  async rescheduleManagedAppointment(
    @Args('token') token: string,
    @Args('startAt') startAt: string,
  ) {
    const { id, barbershopId, previousStartAt } =
      await this.barbershopService.rescheduleManagedAppointment(token, startAt);
    this.realtime.notify(barbershopId, 'APPOINTMENT', 'UPDATED');
    void this.activity.appointmentRescheduled(id, previousStartAt);
    return this.barbershopService.getManagedAppointment(token);
  }

  /** Próximos horários do cliente logado, com o link pra remarcar/cancelar */
  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [ManagedAppointmentType])
  async myUpcomingAppointments(@CurrentClient() client: CurrentClientUser) {
    return this.barbershopService.getClientUpcomingAppointments(client.id);
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

  /** Link "como foi?" do e-mail pós-atendimento: avaliar sem login */
  @Query(() => ReviewRequestType)
  async reviewRequest(@Args('token') token: string) {
    return this.reviewRequests.getReviewRequest(token);
  }

  @Mutation(() => Boolean)
  @ThrottleSlotSearch()
  async submitReviewByLink(
    @Args('token') token: string,
    @Args('rating', { type: () => Int }) rating: number,
    @Args('comment', { nullable: true }) comment?: string,
  ) {
    await this.reviewRequests.submitReview(token, rating, comment);
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
