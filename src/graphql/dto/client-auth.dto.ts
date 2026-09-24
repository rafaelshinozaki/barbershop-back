import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

@InputType()
export class ClientSignupInput {
  @Field()
  @IsEmail({}, { message: 'Email inválido' })
  email: string;

  @Field()
  @IsString()
  @MinLength(8, { message: 'A senha deve ter ao menos 8 caracteres' })
  password: string;

  @Field()
  @IsString()
  @MinLength(2, { message: 'Nome muito curto' })
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  phone?: string;

  /** Idioma do navegador (pt/en/es) — usado nos e-mails pra conta */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;
}

@InputType()
export class ClientLoginInput {
  @Field()
  @IsEmail({}, { message: 'Email inválido' })
  email: string;

  @Field()
  @IsString()
  password: string;
}

@InputType()
export class ClientForgotPasswordInput {
  @Field()
  @IsEmail({}, { message: 'Email inválido' })
  email: string;
}

@InputType()
export class ClientResetPasswordInput {
  @Field()
  @IsString()
  @MaxLength(200)
  token: string;

  @Field()
  @IsString()
  password: string;
}

@InputType()
export class ClientDeleteAccountInput {
  /** Senha atual (conta com senha) */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  password?: string;

  /** E-mail da conta digitado (conta só de login social) */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  email?: string;
}
