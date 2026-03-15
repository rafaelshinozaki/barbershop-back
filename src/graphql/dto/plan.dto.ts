import { InputType, Field, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

@InputType()
export class CreatePlanInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field()
  @IsNotEmpty()
  @IsNumber()
  price: number;

  @Field()
  @IsNotEmpty()
  @IsString()
  billingCycle: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  features?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  stripePriceId?: string;
}

@InputType()
export class UpdatePlanInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsNumber()
  price?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  billingCycle?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  features?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  stripePriceId?: string;
}

@InputType()
export class CreateSubscriptionInput {
  @Field(() => Int)
  @IsNotEmpty()
  @IsNumber()
  planId: number;
}
