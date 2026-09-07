import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { TreatmentCategory } from '../types/enums';

@InputType()
export class SearchBarbershopsInput {
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

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  lat?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  lng?: number;
}

@InputType()
export class CreatePublicAppointmentInput {
  @Field(() => Int)
  @IsInt()
  barbershopId: number;

  @Field(() => Int)
  @IsInt()
  barberId: number;

  @Field(() => Int)
  @IsInt()
  serviceId: number;

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
}
