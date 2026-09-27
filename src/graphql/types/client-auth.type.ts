import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class ClientAccountType {
  @Field(() => Int)
  id: number;

  @Field()
  email: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  /** Sem e-mail confirmado o histórico das barbearias não aparece */
  @Field()
  emailVerified: boolean;

  /** false = conta só de login social (confirma a exclusão digitando o e-mail) */
  @Field()
  hasPassword: boolean;
}

@ObjectType()
export class ClientHistoryEntryType {
  @Field()
  id: string;

  @Field()
  type: string;

  @Field()
  date: string;

  @Field()
  networkName: string;

  @Field()
  barbershopName: string;

  /** Pra "agendar de novo" (página pública da unidade) */
  @Field({ nullable: true })
  barbershopSlug?: string;

  @Field({ nullable: true })
  detail?: string;

  @Field()
  status: string;

  @Field(() => Float, { nullable: true })
  total?: number;

  @Field({ nullable: true })
  currency?: string;

  @Field(() => String, { nullable: true, description: 'Profissional do atendimento' })
  barberName?: string | null;

  @Field(() => Int, { nullable: true, description: 'Pra agendar de novo com o mesmo profissional' })
  barberId?: number | null;

  @Field(() => [Int], { nullable: true, description: 'Serviços do atendimento (agendar de novo)' })
  serviceIds?: number[];

  @Field(() => Int, { nullable: true, description: 'Nota que o cliente deu ao profissional' })
  rating?: number | null;

  @Field(() => Float, { nullable: true, description: 'Caixinha registrada no atendimento' })
  tip?: number | null;

  @Field(() => String, { nullable: true, description: 'Link pra avaliar (atendimento concluído)' })
  reviewUrl?: string | null;
}

/** Profissional favorito do cliente, na unidade em que atende */
@ObjectType()
export class ClientFavoriteBarberType {
  @Field(() => Int)
  barberId: number;

  @Field()
  name: string;

  @Field()
  barbershopName: string;

  @Field()
  barbershopSlug: string;

  @Field({ description: 'Ainda dá pra agendar com ele nessa unidade' })
  available: boolean;
}

@ObjectType()
export class ClientLinkedSocialAccountType {
  @Field()
  provider: string;

  @Field()
  providerEmail: string;

  @Field()
  createdAt: string;
}
