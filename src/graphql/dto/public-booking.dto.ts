import { InputType, Field, Int, Float } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { TreatmentCategory } from '../types/enums';
import { SEARCH_SORTS, type SearchSort } from '@/barbershop/search';

/** Filtros da busca pública de profissionais (e a base da de unidades) */
@InputType()
export class SearchProfessionalsInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  query?: string;

  @Field(() => TreatmentCategory, { nullable: true })
  @IsOptional()
  @IsEnum(TreatmentCategory)
  category?: TreatmentCategory;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  city?: string;

  // Slug de cidade vindo das páginas de SEO categoria×cidade (/search/:categoria/:cidade) —
  // comparado via slugificação da própria cidade cadastrada (ignora acento/caixa), em vez de
  // "contains" no texto livre, pra não depender de acentuação combinar entre URL e banco.
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  citySlug?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Raio em km a partir de lat/lng (padrão 25, até 200)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  radiusKm?: number;

  @Field(() => Float, { nullable: true, description: 'Nota mínima (1 a 5)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;

  @Field(() => Float, { nullable: true, description: 'Serviço mais barato até este valor' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @Field({ nullable: true, description: 'relevance (padrão), distance, rating ou price' })
  @IsOptional()
  @IsIn(SEARCH_SORTS)
  sort?: SearchSort;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@InputType()
export class SearchBarbershopsInput extends SearchProfessionalsInput {
  /** Tipo de estabelecimento (salão, esmalteria...) */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  businessType?: string;

  @Field({ nullable: true, description: 'Só as abertas agora (no fuso de cada unidade)' })
  @IsOptional()
  @IsBoolean()
  openNow?: boolean;
}

@InputType()
export class CreatePublicAppointmentInput {
  @Field(() => Int)
  @IsInt()
  barbershopId: number;

  /** Sem profissional: "qualquer profissional" (o sistema escolhe um livre) */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  barberId?: number | null;

  /** Um serviço (compatibilidade) — ou serviceIds, pra vários em sequência */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  serviceId?: number | null;

  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsInt({ each: true })
  serviceIds?: number[] | null;

  @Field()
  @IsString()
  startAt: string;

  @Field()
  @IsString()
  @MinLength(2, { message: 'Nome muito curto' })
  customerName: string;

  @Field()
  @IsString()
  @MinLength(8, { message: 'Telefone inválido' })
  customerPhone: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  customerEmail?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string;

  // Código de indicação (base36 do id do Customer que indicou), lido do
  // ?ref= da URL pública da barbearia — só tem efeito se o cliente sendo
  // criado for realmente novo (ver createPublicAppointment).
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  referralCode?: string;
}

@InputType()
export class SubscribeToPlanInput {
  @Field(() => Int)
  @IsInt()
  barbershopId: number;

  @Field(() => Int)
  @IsInt()
  planId: number;

  @Field()
  @IsString()
  paymentMethodId: string;
}

@InputType()
export class CreateReviewInput {
  @Field(() => Int)
  @IsInt()
  barbershopId: number;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  comment?: string;
}

/** Lista de espera online: dia cheio, o cliente pede aviso se abrir vaga */
@InputType()
export class JoinPublicWaitlistInput {
  @Field(() => Int)
  @IsInt()
  barbershopId: number;

  /** Sem profissional: qualquer um */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  barberId?: number | null;

  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsInt({ each: true })
  serviceIds?: number[] | null;

  /** Dia (AAAA-MM-DD, no fuso da unidade) */
  @Field()
  @IsString()
  date: string;

  @Field()
  @IsString()
  @MinLength(2, { message: 'Nome muito curto' })
  customerName: string;

  @Field()
  @IsString()
  @MinLength(8, { message: 'Telefone inválido' })
  customerPhone: string;

  /** Obrigatório: o aviso de vaga e o link de sair vão por e-mail */
  @Field()
  @IsEmail({}, { message: 'Email inválido' })
  customerEmail: string;
}
