import { InputType, Field, Int } from '@nestjs/graphql';
import { IsOptional, IsString, IsEmail, IsInt, IsDateString, IsBoolean } from 'class-validator';

@InputType()
export class UpdateUserInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  fullName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  phone?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  company?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  position?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  department?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  gender?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsDateString()
  birthdate?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  professionalSegment?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  knowledgeApp?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  twoFactorEnabled?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  street?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  city?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  neighborhood?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  zipcode?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  state?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  country?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  complement1?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  complement2?: string;
}
