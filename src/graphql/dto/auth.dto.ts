import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsString, IsOptional, IsBoolean } from 'class-validator';

@InputType()
export class LoginInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsString()
  password: string;
}

@InputType()
export class Verify2FAInput {
  @Field()
  @IsString()
  loginId: string;

  @Field()
  @IsString()
  code: string;
}

/** Dados da barbearia para signup como dono */
@InputType()
export class BarbershopSignupData {
  @Field()
  @IsString()
  name: string;

  @Field()
  @IsString()
  slug: string;

  @Field()
  @IsString()
  address: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  complement1?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  complement2?: string;

  @Field()
  @IsString()
  city: string;

  @Field()
  @IsString()
  state: string;

  @Field()
  @IsString()
  country: string;

  @Field()
  @IsString()
  postalCode: string;

  @Field()
  @IsString()
  phone: string;

  @Field()
  @IsString()
  email: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  timezone?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  businessHours?: string;
}

/** Endereço pessoal do usuário no cadastro */
@InputType()
export class UserAddressInput {
  @Field()
  @IsString()
  zipcode: string;

  @Field()
  @IsString()
  street: string;

  @Field()
  @IsString()
  city: string;

  @Field()
  @IsString()
  neighborhood: string;

  @Field()
  @IsString()
  state: string;

  @Field()
  @IsString()
  country: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  complement1?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  complement2?: string;
}

@InputType()
export class CreateUserInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsString()
  password: string;

  @Field()
  @IsString()
  fullName: string;

  @Field()
  @IsString()
  idDocNumber: string;

  @Field()
  @IsString()
  phone: string;

  @Field()
  @IsString()
  gender: string;

  @Field()
  birthdate: Date;

  @Field()
  @IsString()
  company: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  department?: string;

  @Field()
  @IsString()
  professionalSegment: string;

  @Field()
  @IsString()
  knowledgeApp: string;

  @Field()
  @IsBoolean()
  readTerms: boolean;

  /** Endereço pessoal do usuário (opcional — nem todo fluxo de cadastro o coleta) */
  @Field({ nullable: true })
  @IsOptional()
  address?: UserAddressInput;

  /** 'barbershop_owner' = cadastro como dono de barbearia (cria User + Barbershop) */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  signupType?: string;

  /** Dados da barbearia (obrigatório quando signupType='barbershop_owner') */
  @Field({ nullable: true })
  @IsOptional()
  barbershopData?: BarbershopSignupData;
}

@InputType()
export class ForgotPasswordInput {
  @Field()
  @IsEmail()
  email: string;
}

@InputType()
export class TwoFactorInput {
  @Field()
  @IsBoolean()
  enabled: boolean;

  /** Obrigatório quando enabled=true — código enviado por sendTwoFactorCode */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  code?: string;

  /** Obrigatório quando enabled=false — reautentica antes de remover o 2FA */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  currentPassword?: string;
}

@InputType()
export class ForgotPasswordCheckInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsString()
  token: string;
}

@InputType()
export class ResetPasswordInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsString()
  token: string;

  @Field()
  @IsString()
  newPassword: string;
}

@InputType()
export class UpdateNotificationPreferenceInput {
  @Field()
  @IsBoolean()
  newsEmail: boolean;

  @Field()
  @IsBoolean()
  newsInApp: boolean;

  @Field()
  @IsBoolean()
  promotionsEmail: boolean;

  @Field()
  @IsBoolean()
  promotionsInApp: boolean;

  @Field()
  @IsBoolean()
  securityEmail: boolean;

  @Field()
  @IsBoolean()
  securityInApp: boolean;

  @Field()
  @IsBoolean()
  instabilityEmail: boolean;

  @Field()
  @IsBoolean()
  instabilityInApp: boolean;
}

@InputType()
export class RequestChangePasswordCodeInput {
  @Field()
  @IsEmail()
  email: string;
}

@InputType()
export class VerifyChangePasswordCodeInput {
  @Field()
  @IsString()
  code: string;
}

@InputType()
export class ResetPasswordWithCodeInput {
  @Field()
  @IsString()
  currentPassword: string;

  @Field()
  @IsString()
  newPassword: string;

  @Field()
  @IsString()
  code: string;
}

@InputType()
export class CheckPasswordInput {
  @Field()
  @IsString()
  password: string;
}

@InputType()
export class SocialSignupInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsString()
  fullName: string;

  @Field()
  @IsString()
  idDocNumber: string;

  @Field()
  @IsString()
  phone: string;

  @Field()
  @IsString()
  gender: string;

  @Field()
  birthdate: Date;

  @Field()
  @IsString()
  company: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  department?: string;

  @Field()
  @IsString()
  professionalSegment: string;

  @Field()
  @IsString()
  knowledgeApp: string;

  @Field()
  @IsBoolean()
  readTerms: boolean;

  @Field()
  @IsString()
  provider: string;
}
