import { ObjectType, Field, Int, Float } from '@nestjs/graphql';
import { TreatmentCategory } from './enums';

@ObjectType()
export class PublicServiceType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  icon?: string;

  @Field(() => Int)
  durationMinutes: number;

  @Field(() => Float)
  price: number;

  @Field(() => TreatmentCategory)
  category: TreatmentCategory;

  @Field(() => Float, { nullable: true })
  depositAmount?: number;
}

@ObjectType()
export class PublicBarberType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field({ nullable: true })
  specialization?: string;

  @Field(() => [TreatmentCategory])
  specialties: TreatmentCategory[];
}

@ObjectType()
export class PublicSubscriptionPlanType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field(() => Float)
  price: number;

  @Field(() => Int, { nullable: true })
  sessionsPerCycle?: number;

  @Field()
  serviceName: string;
}

/** Outra barbearia no espaço compartilhado (só o que é público) */
@ObjectType()
export class SharedLocationShopType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  address: string;

  @Field()
  city: string;

  @Field()
  state: string;
}

/** Aluguel da cadeira de um vínculo de espaço compartilhado. */
@ObjectType()
export class ChairRentType {
  @Field(() => Int)
  linkId: number;

  /** Quem está vendo é o espaço (true) ou o profissional (false) */
  @Field()
  isHost: boolean;

  /** NONE | AWAITING_PAYMENT | INCOMPLETE | ACTIVE | DUE (mensalidade manual em aberto) | PAST_DUE */
  @Field()
  status: string;

  /** CARD (cartão, Stripe) | MANUAL (pago direto ao espaço) */
  @Field()
  billingMode: string;

  /** Manual: próximo vencimento */
  @Field({ nullable: true })
  nextDueDate?: Date | null;

  /** Mensalidades manuais em aberto (soma) */
  @Field(() => Float)
  openAmount: number;

  @Field(() => Float, { nullable: true })
  amount?: number | null;

  @Field({ nullable: true })
  currency?: string | null;

  /** Pago até (fim do período da última fatura paga) */
  @Field({ nullable: true })
  paidUntil?: Date | null;

  @Field(() => Float)
  totalReceived: number;

  @Field(() => Float)
  platformFeePercent: number;

  /** Só pro espaço: o que entrou pelo cartão menos a taxa da plataforma (o manual já é do espaço) */
  @Field(() => Float, { nullable: true })
  payoutDue?: number | null;
}

@ObjectType()
export class ChairRentPaymentType {
  @Field(() => Int)
  id: number;

  @Field()
  createdAt: Date;

  @Field(() => Float)
  amount: number;

  @Field()
  currency: string;

  /** DUE (em aberto) | SUCCEEDED | FAILED */
  @Field()
  status: string;

  /** CARD | CASH | PIX | TRANSFER | OTHER */
  @Field()
  method: string;

  @Field({ nullable: true })
  dueDate?: Date | null;

  @Field({ nullable: true })
  paidAt?: Date | null;

  @Field()
  overdue: boolean;

  @Field({ nullable: true })
  notes?: string | null;

  /** Quem registrou o pagamento manual */
  @Field({ nullable: true })
  recordedByName?: string | null;

  /** Número do recibo (pagos) */
  @Field({ nullable: true })
  receiptNumber?: string | null;

  @Field({ nullable: true })
  periodStart?: Date | null;

  @Field({ nullable: true })
  periodEnd?: Date | null;

  /** Recibo do Stripe (página) */
  @Field({ nullable: true })
  receiptUrl?: string | null;

  @Field({ nullable: true })
  receiptPdfUrl?: string | null;
}

@ObjectType()
export class ChairRentReceiptType extends ChairRentPaymentType {
  @Field()
  hostName: string;

  @Field()
  hostAddress: string;

  @Field()
  memberName: string;

  @Field()
  memberAddress: string;
}

@ObjectType()
export class AuthorizeChairRentResultType {
  @Field(() => ChairRentType)
  link: ChairRentType;

  /** Cartão pediu confirmação (3D Secure): o front confirma com isto */
  @Field({ nullable: true })
  clientSecret?: string | null;
}

@ObjectType()
export class SharedLocationLinkType {
  @Field(() => Int)
  id: number;

  /** PENDING | ACTIVE */
  @Field()
  status: string;

  @Field()
  createdAt: Date;

  /** A barbearia do outro lado */
  @Field(() => SharedLocationShopType)
  shop: SharedLocationShopType;

  @Field(() => ChairRentType)
  rent: ChairRentType;
}

@ObjectType()
export class SharedLocationOverviewType {
  /** Profissionais independentes que atendem no espaço desta unidade */
  @Field(() => [SharedLocationLinkType])
  asHost: SharedLocationLinkType[];

  /** Espaços onde esta unidade atende como profissional independente */
  @Field(() => [SharedLocationLinkType])
  asMember: SharedLocationLinkType[];
}

/** Dia fechado (sem horário) ou com horário especial */
@ObjectType()
export class ClosureType {
  @Field({ description: 'YYYY-MM-DD no fuso da unidade' })
  date: string;

  @Field({ nullable: true })
  openTime?: string | null;

  @Field({ nullable: true })
  closeTime?: string | null;

  @Field({ nullable: true })
  reason?: string | null;
}

@ObjectType()
export class PublicBarbershopType {
  @Field(() => Int)
  id: number;

  @Field({ nullable: true, description: 'Cor de destaque da franquia (Radix); null = padrão' })
  accentColor?: string;

  @Field({ nullable: true, description: 'Tom de cinza da franquia (Radix); null = padrão' })
  grayColor?: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  address: string;

  @Field({ nullable: true })
  complement1?: string;

  @Field({ nullable: true })
  complement2?: string;

  @Field()
  city: string;

  @Field()
  state: string;

  @Field()
  country: string;

  @Field()
  postalCode: string;

  @Field()
  phone: string;

  @Field()
  email: string;

  @Field({ nullable: true })
  imageUrl?: string;

  @Field()
  timezone: string;

  @Field()
  currency: string;

  @Field(() => [PublicServiceType])
  services: PublicServiceType[];

  @Field(() => [PublicBarberType])
  barbers: PublicBarberType[];

  @Field(() => [PublicSubscriptionPlanType])
  subscriptionPlans: PublicSubscriptionPlanType[];

  @Field(() => Float, { nullable: true })
  averageRating?: number;

  @Field(() => Int)
  reviewCount: number;

  @Field()
  isFeatured: boolean;

  /** Espaço compartilhado: profissionais independentes que atendem aqui */
  @Field(() => [SharedLocationShopType], { defaultValue: [] })
  sharedLocationMembers: SharedLocationShopType[];

  /** Espaços onde este profissional independente atende */
  @Field(() => [SharedLocationShopType], { defaultValue: [] })
  sharedLocationHosts: SharedLocationShopType[];

  /** Feriados e fechamentos dos próximos 60 dias */
  @Field(() => [ClosureType], { defaultValue: [] })
  closures: ClosureType[];
}

@ObjectType()
export class PublicBarbershopSearchResultType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  city: string;

  @Field()
  state: string;

  @Field()
  address: string;

  @Field({ nullable: true })
  imageUrl?: string;

  @Field()
  networkName: string;

  @Field(() => [TreatmentCategory])
  categories: TreatmentCategory[];

  @Field(() => Float, { nullable: true })
  distanceKm?: number;

  @Field(() => Float, { nullable: true })
  averageRating?: number;

  @Field(() => Int)
  reviewCount: number;

  @Field()
  isFeatured: boolean;
}

@ObjectType()
export class ReviewType {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  rating: number;

  @Field({ nullable: true })
  comment?: string;

  @Field()
  createdAt: string;

  @Field()
  reviewerName: string;

  /** Resposta pública da unidade */
  @Field({ nullable: true })
  reply?: string | null;

  @Field({ nullable: true })
  repliedAt?: string | null;
}

@ObjectType()
export class MyReviewType {
  @Field(() => Int)
  rating: number;

  @Field({ nullable: true })
  comment?: string;
}

/** Página "como foi?" do link do e-mail pós-atendimento */
@ObjectType()
export class ReviewRequestType {
  @Field()
  barbershopName: string;

  @Field()
  barbershopSlug: string;

  @Field({ description: 'Primeiro nome do cliente' })
  customerName: string;

  @Field()
  barberName: string;

  @Field()
  serviceNames: string;

  @Field()
  startAt: string;

  @Field({ nullable: true })
  timezone?: string;

  @Field(() => Int, { nullable: true, description: 'Nota que o cliente já deu (editar)' })
  rating?: number | null;

  @Field({ nullable: true })
  comment?: string | null;
}

/** Próximo horário livre na página pública */
@ObjectType()
export class PublicNextSlotType {
  @Field({ description: 'Dia (YYYY-MM-DD, no fuso da unidade)' })
  date: string;

  @Field()
  startAt: string;
}

@ObjectType()
export class PublicAppointmentType {
  @Field(() => Int)
  id: number;

  @Field()
  startAt: string;

  @Field()
  endAt: string;

  @Field()
  status: string;

  @Field()
  barbershopName: string;

  @Field()
  barberName: string;

  @Field()
  serviceName: string;

  @Field(() => Float)
  price: number;

  @Field()
  currency: string;

  @Field(() => Float, { nullable: true })
  depositAmount?: number;

  @Field({ description: 'Token do link "gerenciar agendamento" (o mesmo do e-mail)' })
  manageToken: string;
}

/** Agendamento aberto pelo link do e-mail (cliente cancela/remarca sem login). */
@ObjectType()
export class ManagedAppointmentType {
  @Field(() => Int)
  id: number;

  @Field()
  status: string;

  @Field()
  startAt: string;

  @Field()
  endAt: string;

  @Field({ description: 'Ainda dá pra cancelar/remarcar pelo link' })
  canChange: boolean;

  @Field({ description: 'Até quando dá pra mudar pelo link (política de cancelamento)' })
  changeDeadline: string;

  @Field(() => Int)
  cancellationWindowHours: number;

  @Field()
  customerName: string;

  @Field(() => Int)
  barbershopId: number;

  @Field()
  barbershopName: string;

  @Field()
  barbershopSlug: string;

  @Field({ nullable: true })
  barbershopPhone?: string;

  @Field()
  barbershopAddress: string;

  @Field({ nullable: true })
  timezone?: string;

  @Field(() => Int)
  barberId: number;

  @Field()
  barberName: string;

  @Field(() => Int, { nullable: true })
  serviceId?: number | null;

  @Field(() => [Int], {
    description: 'Todos os serviços do horário (remarcar usa a duração somada)',
  })
  serviceIds: number[];

  @Field()
  serviceName: string;

  @Field(() => Float)
  price: number;

  @Field()
  currency: string;

  /** Link de gerenciar (só na lista de próximos horários do cliente logado) */
  @Field({ nullable: true })
  manageToken?: string;
}
