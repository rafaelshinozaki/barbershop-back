// src\plan\dto\plan.dto.ts
import { IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

export class PlanDTO {
  id: number;

  @IsOptional()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsNumber()
  price: number;

  @IsNotEmpty()
  @IsString()
  billingCycle: string;

  @IsOptional()
  @IsString()
  features?: string;

  @IsOptional()
  @IsString()
  stripePriceId?: string;
}
