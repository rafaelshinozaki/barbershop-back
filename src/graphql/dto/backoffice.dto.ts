import { InputType, Field, Int, ObjectType } from '@nestjs/graphql';
import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsEmail,
  IsBoolean,
  IsDateString,
} from 'class-validator';

@InputType()
export class AddressInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  zipcode?: string;

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
  state?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  country?: string;
}

@InputType()
export class UserSystemConfigInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  theme?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  accentColor?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  grayColor?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  radius?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  scaling?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  language?: string;
}

@InputType()
export class EmailNotificationInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  news?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  promotions?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  instability?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  security?: boolean;
}

@InputType()
export class UpdateUserByAdminInput {
  @Field(() => Int)
  @IsInt()
  userId: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  fullName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  phone?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsDateString()
  birthdate?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  company?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  professionalSegment?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  jobTitle?: string;

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
  @IsBoolean()
  isActive?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  twoFactorEnabled?: boolean;

  @Field(() => AddressInput, { nullable: true })
  @IsOptional()
  address?: AddressInput;

  @Field(() => UserSystemConfigInput, { nullable: true })
  @IsOptional()
  userSystemConfig?: UserSystemConfigInput;

  @Field(() => EmailNotificationInput, { nullable: true })
  @IsOptional()
  emailNotification?: EmailNotificationInput;
}

@InputType()
export class UsersDetailedFilters {
  @Field(() => Int, { defaultValue: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Field(() => Int, { defaultValue: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  email?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  country?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  city?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  role?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  plan?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  status?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  gender?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  ageRange?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  professionalSegment?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  company?: string;
}

@InputType()
export class BulkUserAction {
  @Field(() => [Int])
  userIds: number[];

  @Field()
  action: string; // 'activate', 'deactivate', 'changePlan'

  @Field({ nullable: true })
  plan?: string;
}

@InputType()
export class OverduePaymentsFilters {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  user?: string; // Nome ou email do usuário

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  plan?: string; // Nome do plano

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  nextPaymentDateMonth?: string; // Formato: "YYYY-MM"

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  paymentMethod?: string; // Método de pagamento
}

@InputType()
export class CompletedPaymentsFilters {
  @Field(() => Int, { defaultValue: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Field(() => Int, { defaultValue: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  user?: string; // Nome ou email do usuário

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  plan?: string; // Nome do plano

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  paymentDateMonth?: string; // Formato: "YYYY-MM"

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  nextPaymentDateMonth?: string; // Formato: "YYYY-MM"

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  status?: string; // Status do pagamento

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  paymentMethod?: string; // Método de pagamento
}

@InputType()
export class SendEmailNotificationInput {
  @Field(() => [Int])
  @IsInt({ each: true })
  userIds: number[];

  @Field()
  @IsString()
  subject: string;

  @Field()
  @IsString()
  message: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  actionUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  actionText?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  type?: string; // 'info', 'warning', 'success', 'error'
}

@InputType()
export class EmailHistoryFilters {
  @Field(() => Int, { defaultValue: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Field(() => Int, { defaultValue: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  user?: string; // Nome ou email do usuário

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  subject?: string; // Assunto do email

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  dateFrom?: string; // Data de início (formato YYYY-MM-DD)

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  dateTo?: string; // Data de fim (formato YYYY-MM-DD)
}

@ObjectType()
export class EmailHistoryItem {
  @Field(() => Int)
  id: number;

  @Field()
  sentTo: string;

  @Field()
  subject: string;

  @Field()
  body: string;

  @Field()
  meta: string;

  @Field()
  createdAt: string;

  @Field(() => Int)
  userId: number;

  @Field()
  userName: string;

  @Field()
  userEmail: string;
}

@ObjectType()
export class PaginatedEmailHistory {
  @Field(() => [EmailHistoryItem])
  data: EmailHistoryItem[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  totalPages: number;
}
