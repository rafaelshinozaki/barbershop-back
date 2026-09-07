import { Resolver, Query, Mutation, Args, Int, Context } from '@nestjs/graphql';
import { NotFoundException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
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
import { CreatePublicAppointmentInput, SearchBarbershopsInput, CreateReviewInput } from '../dto/public-booking.dto';
import { ThrottlePublicBooking } from '@/common/decorators/throttle.decorator';
import { TreatmentCategory } from '../types/enums';

// Sem @UseGuards em nenhum método — esta é a superfície pública da API,
// pensada pra ser acessada por qualquer visitante (a página de uma unidade
// e o fluxo de auto-agendamento não pedem login).
@Resolver()
export class PublicBookingResolver {
  constructor(
    private readonly barbershopService: BarbershopService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @Query(() => PublicBarbershopType)
  async publicBarbershop(@Args('slug') slug: string) {
    return this.barbershopService.getPublicBarbershopByslug(slug);
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
  private getOptionalClientAccountId(req: any): number | undefined {
    const token = req?.cookies?.ClientAuthentication;
    if (!token) return undefined;
    try {
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as ClientTokenPayload;
      return decoded.clientAccountId;
    } catch {
      return undefined;
    }
  }

  @ThrottlePublicBooking()
  @Mutation(() => PublicAppointmentType)
  async createPublicAppointment(
    @Args('input') input: CreatePublicAppointmentInput,
    @Context() context: any,
  ): Promise<PublicAppointmentType> {
    const clientAccountId = this.getOptionalClientAccountId(context.req);
    const appointment = await this.barbershopService.createPublicAppointment({
      ...input,
      clientAccountId,
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');

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
      depositAmount: appointment.depositAmount != null ? Number(appointment.depositAmount) : undefined,
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
  async createOrUpdateReview(@CurrentClient() client: CurrentClientUser, @Args('input') input: CreateReviewInput) {
    await this.barbershopService.createOrUpdateReview(client.id, input.barbershopId, input.rating, input.comment);
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
}
